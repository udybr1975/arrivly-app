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
  // Reasoning-model thinking depth. Defaults to 'low' — see DEFAULT_REASONING_EFFORT.
  // SILENTLY IGNORED unless the resolved GROQ_MODEL is a gpt-oss model: the field is sent only
  // behind the model-id guard below, because other Groq models take a different value set and
  // would 400 on it. Passing it here is therefore a request, never a guarantee.
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export function isAiConfigError(e: unknown): boolean {
  return Boolean((e as { configError?: boolean } | null | undefined)?.configError)
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq DECOMMISSIONED llama-3.3-70b-versatile on 16 Aug 2026 — every surface returned
// `404 model_not_found` until GROQ_MODEL was repointed. This fallback exists for the case where
// GROQ_MODEL is unset or empty, so it must never name a retired model.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 2

// ALWAYS SENT (see body construction below), never conditional. Groq debits TPM as a
// RESERVATION of promptTokens + max_tokens, so omitting the field hands Groq an unknown — and
// plausibly the model's 65,536 ceiling, eight times the entire per-minute allowance. Making
// omission impossible is cheaper than discovering what Groq reserves by default.
//
// 1,024 rather than the largest audited need (3,500): every existing call site passes maxTokens
// explicitly, so this value only ever governs a NEW or mis-written site. For that case a
// conservative reservation fails visibly (a short or EMPTY answer — on a reasoning model the
// trace is emitted first and billed from the same allowance, so an under-budgeted call returns
// no content at all) instead of silently throttling every other surface in the org for a minute.
const DEFAULT_MAX_TOKENS = 1024

// Sent only on models that accept it — see the guard at the body construction below.
const DEFAULT_REASONING_EFFORT = 'low'

// ── Rate-limit / token observability ──────────────────────────────────────────────────────
//
// OBSERVABILITY ONLY. Nothing below feeds a decision: no brake, no throttle, no backoff keyed
// on these values, no early return. This file decides WHICH model answers, never WHO may ask
// or HOW OFTEN — every brake stays at its call site. Adding a limiter here would be a scope
// violation, not an improvement.
//
// WHY IT EXISTS: Groq returns rate-limit state on EVERY response and nothing ever read it, so
// CLAUDE.md carried "6K TPM org-wide" — which is the llama-3.1-8b-instant row, not ours. An
// assumed ceiling survived because the real one was never observed. This closes that for good.
//
// CURRENT CEILINGS — read from live response headers on `openai/gpt-oss-120b` against the
// production free-tier key, 17 Aug 2026:
//     requests per DAY  (RPD) = 1,000
//     tokens per MINUTE (TPM) = 8,000
// TPD is NOT returned as a header at all and cannot be observed here. TPM DROPPED from the
// retired llama-3.3-70b-versatile's 12,000 to 8,000, and TPM is the binding constraint: Groq
// debits it as promptTokens + max_tokens RESERVED, never the completion actually generated.
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
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number } | null
  } | null,
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
    // Reasoning tokens are billed INSIDE completion_tokens, so they are spent out of the same
    // max_tokens allowance as the answer — which makes them the new cost driver and the reason a
    // budget sized for a non-reasoning model can now come back truncated. Logged so that is
    // observed rather than assumed, on the same "only when present and numeric" rule as above.
    if (typeof usage?.completion_tokens_details?.reasoning_tokens === 'number') {
      out.reasoningTokens = usage.completion_tokens_details.reasoning_tokens
    }
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
  // UNCONDITIONAL — never `if (opts.maxTokens != null)`. See DEFAULT_MAX_TOKENS: an absent
  // max_tokens leaves the TPM reservation up to Groq, and the reservation is what is billed.
  body.max_tokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  if (opts.temperature != null) body.temperature = opts.temperature
  // gpt-oss models are REASONING models: Groq returns the trace in a separate
  // `message.reasoning` field (so the extractor below, which reads `message.content` only, needs
  // no stripping), but bills those tokens INSIDE completion_tokens — i.e. out of the SAME
  // max_tokens allowance as the answer. Unbounded thinking therefore silently eats the answer
  // budget and can truncate or empty a response. Same reasoning, and the same conclusion, as the
  // recorded `gemini-2.5-flash` `thinkingConfig: { thinkingBudget: 0 }` decision.
  //
  // GUARDED BY MODEL ID, because GROQ_MODEL is operator-settable and the accepted value set is
  // model-specific (qwen3 takes 'none'/'default'); sending an unsupported value risks a 400, so
  // a model swap must not hard-fail on a field it never asked for.
  if (model.startsWith('openai/gpt-oss')) {
    body.reasoning_effort = opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT
  }
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
        // `completion_tokens_details.reasoning_tokens` appears only on reasoning models.
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          completion_tokens_details?: { reasoning_tokens?: number } | null
        }
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
