import { scrubErr } from './scrub.js'

// Tavily web search for the ZERO-GOOGLE AI PILOT events pipeline (Step 5).
// Best-effort, never throws, returns [] on any failure.
//
// KEY LOCATION DIFFERS FROM geoapify.ts / geo.ts, and that changes what is safe to log: the
// Tavily key travels in an `Authorization: Bearer` HEADER, not in the URL. So logging the
// response STATUS is safe here — there is no URL carrying a secret. Still never log the body,
// the headers, the request, or the raw error object.
//
// PRIVACY, load-bearing (see CLAUDE.md): Tavily has NO self-serve DPA and its subprocessors
// include Groq, Cohere and OpenAI, all US. NO guest text and NO personal data may ever enter a
// query. Callers build queries from city/country/date-window only — this module simply forwards
// whatever string it is given, so the rule lives at the call site and is stated there too.
//
// FREE-TIER RATE GATE: same module-level start-spacing pattern as geoapify.ts. Callers run
// searches STRICTLY SEQUENTIALLY; the gate exists so a future caller that forgets cannot burst.

const TAVILY_URL = 'https://api.tavily.com/search'
const MIN_START_GAP_MS = 250
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_MAX_RESULTS = 8

// Cap at ingest — the B2.1 pattern. This is arbitrary third-party WEB text, the least trusted
// input in the stack, and it flows into a model prompt and (via extraction) onto the guest page.
// A SNIPPET'S TOKEN COST IS THE SUM OF ALL THREE CAPS PLUS JSON SCAFFOLDING — never content
// alone. Both B3.3 review gates caught a budget here that had been sized off
// MAX_SNIPPETS x MAX_CONTENT_LEN and silently omitted title and url; the corrected arithmetic
// lives at the dedupe site in city-events.ts. Worst case per snippet is
// title + url + content + ~40 chars of keys/quotes/commas.
const MAX_TITLE_LEN = 140 // 140 (B3.3, was 200): titles are short; the tail was pure budget.
// 300 (B3.3, was 500). Urls tokenize far worse than prose (~3 chars/token vs ~4), so the tail of
// this cap was the most expensive unused budget in the corpus. Enforced by DROPPING an over-long
// result, never truncating it — see the ingest loop.
const MAX_URL_LEN = 300
// 900 (B3.3, was 500). This caps ONE snippet; it no longer bounds the corpus. Since 17 Aug 2026
// the corpus is bounded by CORPUS_TOKEN_BUDGET in city-events.ts, derived from the verified
// 8,000 TPM ceiling — a fixed count x a char cap could not bound the worst case, because a
// non-Latin-script city breaches before any char cap bites. Do not re-derive a corpus total from
// this constant; it is a per-snippet bound only.
//
// WHY 900 AND NOT LESS: 500 was too tight — a city events CALENDAR page lists twenty events in
// the space a single-venue page uses for one, so the cap was discarding exactly the signal the
// extractor needs. WHY NOT MORE: an oversized extraction prompt does not merely fail itself, it
// can 429 the guide and daily-greeting across every tenant on the shared org-wide per-minute
// pool. Input and output share ONE ceiling, so more input must come OUT of the rest of the
// budget, never on top of it.
const MAX_CONTENT_LEN = 900

let gateChain: Promise<void> = Promise.resolve()
let lastStart = 0

function rateGate(): Promise<void> {
  const next = gateChain.then(async () => {
    const now = Date.now()
    const wait = lastStart + MIN_START_GAP_MS - now
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    lastStart = Date.now()
  })
  // Keep the chain alive even if a waiter is cancelled upstream.
  gateChain = next.catch(() => {})
  return next
}

export interface WebResult {
  title: string
  url: string
  content: string
}

interface TavilyRaw {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>
}

const SAFE_SCHEME = /^https?:\/\//i

/**
 * One Tavily search. Never throws; [] means "no usable result", never an error to surface.
 * Shape verified against Tavily's API reference on 2026-08-06.
 */
export async function searchWeb(
  query: string,
  opts: {
    maxResults?: number
    topic?: 'general' | 'news'
    timeoutMs?: number
    // WHAT time_range ACTUALLY FILTERS: the PAGE's publication / last-indexed date, NOT the date
    // of anything described on the page. It is a recency filter on documents, not on events.
    // Defaults to 'week' for callers that genuinely want freshly-published documents. Pass null
    // to OMIT the parameter — the events pipeline does exactly that (B3.3), because a city events
    // calendar (MyHelsinki, a tapahtumat portal, a venue what's-on page) is a LONG-LIVED page
    // that may have been published months ago while listing next week's programme, so 'week'
    // excluded the highest-signal sources and biased the corpus toward freshly-published noise.
    // Step 6's chat router likewise asks "nearby X" / open-web questions that are not week-scoped.
    timeRange?: 'day' | 'week' | 'month' | 'year' | null
  } = {},
): Promise<WebResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    // Safe to log: the key is absent, so there is nothing to leak.
    console.warn('[tavily] TAVILY_API_KEY not configured')
    return []
  }
  if (!query.trim()) return []

  const timeRange = opts.timeRange === undefined ? 'week' : opts.timeRange
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    // Inside the try: this function's never-throws contract is load-bearing (the caller's loop
    // has no try of its own), and awaiting the gate outside it would let a rejection escape.
    await rateGate()
    timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        // 'basic' DELIBERATELY, not 'advanced': advanced costs 2 credits per call against the
        // 1000/month free allowance, and the events extraction reads snippets rather than
        // full pages, so the extra depth buys nothing here.
        search_depth: 'basic',
        topic: opts.topic ?? 'general',
        max_results: opts.maxResults ?? DEFAULT_MAX_RESULTS,
        ...(timeRange ? { time_range: timeRange } : {}),
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      // Status only — never the URL, body, headers or error object.
      console.warn('[tavily] request failed', { status: res.status })
      return []
    }

    const data = (await res.json()) as TavilyRaw
    const results = Array.isArray(data?.results) ? data.results : []

    const out: WebResult[] = []
    for (const r of results) {
      const title = typeof r?.title === 'string' ? r.title.trim().slice(0, MAX_TITLE_LEN) : ''
      const url = typeof r?.url === 'string' ? r.url.trim() : ''
      // Drop anything without a usable title or a http(s) url — a snippet we cannot attribute
      // is not worth feeding to the extractor.
      //
      // THE URL IS DROPPED WHEN OVER-LONG, NEVER TRUNCATED (B3.3). It is an IDENTITY key, not
      // display text: city-events.ts builds its provenance allowlist from these exact strings and
      // the winner is rendered as a clickable link on the guest page. A truncated url passes the
      // allowlist (it is literally what the model was shown) and ships a BROKEN link. That was
      // latent since Step 5 only because every url came back empty; the B3.3 prompt fix is
      // precisely what makes it reachable, so it is closed here rather than left as a warning.
      if (!title || url.length > MAX_URL_LEN || !SAFE_SCHEME.test(url)) continue
      out.push({
        title,
        url,
        content: typeof r?.content === 'string' ? r.content.trim().slice(0, MAX_CONTENT_LEN) : '',
      })
    }
    return out
  } catch (e) {
    // Abort, network error, parse error → []. Scrubbed so a key can never reach the log even
    // if a future SDK/runtime embeds one in the message.
    console.warn('[tavily] search failed —', scrubErr(e, 120))
    return []
  } finally {
    clearTimeout(timer)
  }
}
