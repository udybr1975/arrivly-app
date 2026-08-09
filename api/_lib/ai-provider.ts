import { withRetry } from './retry.js'
import { scrubErr } from './scrub.js'

// Thin, dependency-free provider abstraction for the ZERO-GOOGLE AI PILOT (see CLAUDE.md).
//
// SCOPE OF THIS FILE: it decides WHICH model answers. It never decides WHO may ask or HOW
// OFTEN — every brake, counter bump, cooldown, cache and rate limit stays at the call site,
// OUTSIDE the provider branch, so one counter unit is one call regardless of provider.
//
// The `gemini` case deliberately THROWS here: Gemini is not reimplemented in this file. Each
// call site keeps its existing, already-reviewed Gemini code path behind `resolveProvider()`,
// so a rollback is an env-var flip rather than a code change. This file exists so the env
// contract is uniform across surfaces.

export type AiSurface =
  | 'greeting'
  | 'rewrite'
  | 'bulk_import'
  | 'guide_assistant'
  | 'chat'
  | 'events'
  | 'guide'
  | 'host_picks'

// 'poi' is the guide's Geoapify-POI-data pipeline (pilot Step 4). It is meaningful ONLY on the
// 'guide' surface; anywhere else it is treated as a typo — see resolveProvider.
// NOTE for operators: on the guide surface 'groq' ALSO yields the POI pipeline, because the
// guide's only non-POI implementation is the Gemini one. The sole value that turns POI off is
// 'gemini' — setting AI_PROVIDER_GUIDE=groq will not disable the Geoapify leg.
export type AiProvider = 'groq' | 'gemini' | 'poi'

// Per-surface override env var. Full enum is declared now so later pilot steps only have to
// wire their call site, not touch this map.
const SURFACE_ENV: Record<AiSurface, string> = {
  greeting: 'AI_PROVIDER_GREETING',
  rewrite: 'AI_PROVIDER_REWRITE',
  bulk_import: 'AI_PROVIDER_BULK_IMPORT',
  guide_assistant: 'AI_PROVIDER_GUIDE_ASSISTANT',
  chat: 'AI_PROVIDER_CHAT',
  events: 'AI_PROVIDER_EVENTS',
  guide: 'AI_PROVIDER_GUIDE',
  host_picks: 'AI_PROVIDER_HOST_PICKS',
}

// AI_PROVIDER_<SURFACE> -> AI_PROVIDER_DEFAULT -> 'groq'. An unrecognised value falls back to
// the pilot default rather than failing the request, but warns loudly so a typo is visible
// instead of silently routing a surface to the wrong provider.
export function resolveProvider(surface: AiSurface): AiProvider {
  // `||` not `??`: Vercel can hold an EMPTY string, which is not nullish and would otherwise
  // skip AI_PROVIDER_DEFAULT entirely and warn on every single request.
  const raw = (process.env[SURFACE_ENV[surface]] || process.env.AI_PROVIDER_DEFAULT || 'groq')
    .trim()
    .toLowerCase()
  if (raw === 'gemini') return 'gemini'
  // Guide only. On any other surface 'poi' falls through to the unrecognised-value warn below
  // and lands on groq, so a mis-set AI_PROVIDER_CHAT=poi cannot silently change chat behaviour.
  if (raw === 'poi' && surface === 'guide') return 'poi'
  if (raw !== 'groq') {
    // scrubbed + hard-truncated: this echoes an env VALUE, so a mis-pasted key must not land
    // in the logs on every request.
    console.warn(`[ai-provider] unrecognised provider "${scrubErr(raw, 20)}" for surface "${surface}" - using groq`)
  }
  return 'groq'
}

export interface AiGenerateOpts {
  system?: string
  messages?: { role: 'user' | 'assistant'; content: string }[]
  prompt?: string
  json?: boolean
  maxTokens?: number
  temperature?: number
  // BUDGET PARITY — load-bearing, do not drop at a call site. Each site passes the SAME attempt
  // count and per-attempt timeout its Gemini path used. Without this a provider swap silently
  // re-sizes every brake through its retry count: a uniform retries:2 turned bulk-import's
  // single 10s shot into 3 attempts / ~92s, and moved daily-greeting's 50/h ceiling from ~100
  // model calls to ~150. One counter unit must cost the same number of calls on both paths.
  retries?: number
  timeoutMs?: number
}

export function isAiConfigError(e: unknown): boolean {
  return Boolean((e as { configError?: boolean } | null | undefined)?.configError)
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2

// ── Rate-limit / token observability ──────────────────────────────────────────────────────
//
// OBSERVABILITY ONLY. Nothing below feeds a decision: no brake, no throttle, no backoff keyed
// on these values, no early return. This file decides WHICH model answers, never WHO may ask
// or HOW OFTEN — every brake stays at its call site. Adding a limiter here would be a scope
// violation, not an improvement.
//
// WHY IT EXISTS: Groq returns rate-limit state on EVERY response and nothing ever read it, so
// CLAUDE.md carried "6K TPM org-wide" — which is the llama-3.1-8b-instant row, not ours. The
// model actually used here (llama-3.3-70b-versatile) is 12K TPM / 1K RPD / 100K TPD. An
// assumed ceiling survived because the real one was never observed. This closes that for good.
//
// Emitted once per HTTP ATTEMPT, so a retried call produces more than one line — deliberate,
// since each attempt carries its own headers and the retried one is usually the interesting one.
type UsageLog = Record<string, string | number>

// Adds a field only when the header is present and non-empty, so absent limits log nothing
// rather than null noise. Numeric values are coerced; anything else passes through verbatim so
// an unexpected format stays visible instead of becoming NaN.
function addHeader(out: UsageLog, key: string, res: Response, header: string): void {
  const raw = res.headers.get(header)
  if (raw == null || raw === '') return
  const n = Number(raw)
  out[key] = Number.isFinite(n) ? n : raw
}

// STRICT WHITELIST. Only the headers named here are ever read or logged — never the request
// headers, and never anything derived from GROQ_API_KEY.
function logGroqUsage(
  surface: AiSurface,
  model: string,
  res: Response,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
): void {
  try {
    // `model` is an env VALUE (GROQ_MODEL) echoed on EVERY call, so it gets the same treatment
    // resolveProvider gives AI_PROVIDER_* above: a mis-pasted key must not land in the logs on
    // every request. scrubErr redacts gsk_/AIza/tvly- prefixes BEFORE truncating, so a key
    // cannot survive as a fragment, and it leaves a real model name untouched.
    //
    // 64, not resolveProvider's 20: SIZE AN ENV-VALUE CAP FROM THE LONGEST PLAUSIBLE LEGITIMATE
    // VALUE, NOT THE SHORTEST ONE IN FRONT OF YOU. That cap bounds a provider enum ('gemini',
    // 6 chars); this one bounds a MODEL ID, and Groq's namespaced ids already run to 45
    // (`meta-llama/llama-4-maverick-17b-128e-instruct`) — 40 would have clipped the very field
    // this logging exists to observe.
    const out: UsageLog = { surface, model: scrubErr(model, 64), status: res.status }
    if (typeof usage?.prompt_tokens === 'number') out.promptTokens = usage.prompt_tokens
    if (typeof usage?.completion_tokens === 'number') out.completionTokens = usage.completion_tokens
    if (typeof usage?.total_tokens === 'number') out.totalTokens = usage.total_tokens
    // NOTE: `x-ratelimit-limit-requests` is REQUESTS PER **DAY** (RPD), not per minute. Groq's
    // naming is genuinely misleading here — do not read it as RPM.
    addHeader(out, 'rpdLimit', res, 'x-ratelimit-limit-requests')
    addHeader(out, 'rpdRemaining', res, 'x-ratelimit-remaining-requests')
    // NOTE: `x-ratelimit-limit-tokens` is TOKENS PER **MINUTE** (TPM), not per day. The per-day
    // token ceiling (TPD) is not returned as a header at all.
    addHeader(out, 'tpmLimit', res, 'x-ratelimit-limit-tokens')
    addHeader(out, 'tpmRemaining', res, 'x-ratelimit-remaining-tokens')
    // Groq formats this as e.g. "7.66s"; passed through verbatim rather than parsed.
    addHeader(out, 'tpmResetS', res, 'x-ratelimit-reset-tokens')
    addHeader(out, 'retryAfter', res, 'retry-after') // present only on a 429
    console.log('[ai-provider] groq usage', JSON.stringify(out))
    // Same data at warn level so a 429 is visible without a log query.
    if (res.status === 429) console.warn('[ai-provider] groq 429 rate limited', JSON.stringify(out))
  } catch {
    // Observability must NEVER fail a generation.
  }
}

export async function aiGenerate(surface: AiSurface, opts: AiGenerateOpts): Promise<string> {
  const provider = resolveProvider(surface)
  if (provider === 'gemini') {
    // Not reachable through a correctly-written call site: the site branches on
    // resolveProvider() and runs its own Gemini code. This guards a mis-wired future site.
    throw new Error('gemini branch handled at call site')
  }
  // 'groq' and 'poi' both land here: the POI pipeline still uses Groq for its PROSE leg, and
  // its data legs (Geoapify) are the caller's job, not this abstraction's.
  // `surface` is threaded through for LOG ATTRIBUTION ONLY — it never selects a model, a key
  // or a limit inside groqGenerate.
  return groqGenerate(surface, opts)
}

async function groqGenerate(surface: AiSurface, opts: AiGenerateOpts): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  // Never interpolate the key into any message, log or thrown error. Thrown OUTSIDE the retry
  // closure, so a missing key fails immediately instead of burning attempts. `configError`
  // lets a call site distinguish "not configured" from "the model failed" — see
  // guide-assistant, which maps them to different HTTP bodies exactly as the Gemini path did.
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY not configured'), { configError: true })
  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL

  // OpenAI chat format: optional system turn, then prior turns, then this turn's prompt.
  const messages: { role: string; content: string }[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  for (const m of opts.messages ?? []) messages.push({ role: m.role, content: m.content })
  if (opts.prompt) messages.push({ role: 'user', content: opts.prompt })
  if (!messages.some(m => m.role === 'user')) {
    throw new Error('aiGenerate: no user content supplied')
  }

  const body: Record<string, unknown> = { model, messages }
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens
  if (opts.temperature != null) body.temperature = opts.temperature
  // Groq requires the word "JSON" to appear in the prompt when json mode is on; every call
  // site that passes json:true already instructs JSON output explicitly.
  if (opts.json) body.response_format = { type: 'json_object' }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const call = async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        // The scrubbed body is logged here and hung on `detail`, deliberately NOT put in
        // `message`: withRetry's isTransient() falls through to a regex over the message, so a
        // 4xx body merely CONTAINING "500"/"timeout"/"network" would have been retried —
        // defeating the never-retry-4xx rule. `status` is the field isTransient reads first.
        const detail = scrubErr(await res.text().catch(() => ''), 200)
        console.warn(`[ai-provider] groq ${res.status} - ${detail}`)
        // Logged on the NON-OK path too — the 429 is exactly where these headers matter, and
        // there is no usage body to report. Purely additive: the error below is unchanged.
        logGroqUsage(surface, model, res)
        const err = new Error(`groq_http_${res.status}`) as Error & { status?: number; detail?: string }
        err.status = res.status
        err.detail = detail
        throw err
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        // OpenAI-compatible, and OPTIONAL — treated as absent rather than assumed present.
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      }
      logGroqUsage(surface, model, res, data.usage)
      return data
    } finally {
      clearTimeout(timer)
    }
  }

  const data = await withRetry(call, { retries: opts.retries ?? DEFAULT_RETRIES, baseDelayMs: 600 })
  return data.choices?.[0]?.message?.content ?? ''
}
