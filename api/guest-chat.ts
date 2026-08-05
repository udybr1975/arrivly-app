import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { scrubErr } from './_lib/scrub.js'
import { resolveGuestAccess, buildGuestSystemInstruction } from './_lib/guest-access.js'
import { sendNtfy } from './_lib/ntfy.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MODEL = 'gemini-2.5-flash'
const MAX_MESSAGE = 1000
const MAX_HISTORY = 10
const MAX_RETRIES = 2
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/

// Best-effort, per-instance rate limiter — a spend cap on the VERIFIED Gemini path.
// Unverified (public) callers are refused (403) before they ever reach this, so the
// limiter only ever counts real verified-guest chat turns. Keyed by apartmentId+IP.
const RL_MAX = 15
const RL_WINDOW_MS = 60_000
const RL_MAX_KEYS = 5000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
  // Opportunistic bounded-memory sweep: drop expired entries when the map grows large.
  if (rlHits.size > RL_MAX_KEYS) {
    for (const [k, v] of rlHits) {
      if (now - v.windowStart >= RL_WINDOW_MS) rlHits.delete(k)
    }
  }
  const entry = rlHits.get(key)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}
function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) return first.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId, token, message, history } = (req.body ?? {}) as {
    apartmentId?: string; token?: string | null; message?: string; history?: any[]
  }
  if (!apartmentId || typeof apartmentId !== 'string') return res.status(400).json({ error: 'apartmentId required' })
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' })

  // Authoritative apartment from DB; client is trusted only for the id + token.
  const { data: apt } = await supabase
    .from('apartments')
    .select('id, name, city, country, neighborhood, street, street_number, host_id, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (!apt || apt.is_visible === false) return res.status(404).json({ error: 'not_found' })

  // Normalise + validate the booking token before resolving access.
  const rawToken = (typeof token === 'string' && token !== 'null') ? token.trim() : ''
  const cleanToken = rawToken && TOKEN_RE.test(rawToken) ? rawToken : null

  const access = await resolveGuestAccess(supabase, apt.id, cleanToken)

  // GATE: only verified guests may spend a Gemini call. A public caller (no/invalid
  // token) is refused here — NO Gemini, NO brand fetch, NO system-instruction build.
  // Not an error: refusals are not logged.
  if (access.tier === 'public') return res.status(403).json({ error: 'verify_required' })

  // Spend cap on the verified path.
  if (rateLimited(`${apt.id}:${clientIp(req)}`, Date.now())) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // Cross-instance per-host hourly cap — the REAL cap (the per-instance limiter above is
  // porous across Lambdas). guest-chat is GROUNDED, the dearest call in the system, so this
  // is the most important brake. Keyed on the apartment's HOST (caller is unauthenticated;
  // a token for host X can only ever charge host X). Over the cap => 429, which ChatBot
  // renders as soft "lots of questions" copy. ONE ntfy at limit+1.
  // FAIL CLOSED on a counter error (like daily-greeting, unlike the host-auth brakes): a
  // block here only shows the guest the soft retry line, while failing open would spend the
  // dearest key during exactly the burst that breaks the counter. A non-numeric return is
  // only reachable via an operator-side RPC change, never guest input, so it logs loudly and
  // proceeds rather than hard-disabling the endpoint on a shape change.
  const CHAT_HOURLY_LIMIT = 40
  {
    const { data: chatCount, error: chatCountErr } = await supabase.rpc('bump_api_counter', {
      p_host_id: apt.host_id,
      p_endpoint: 'guest-chat',
    })
    if (chatCountErr) {
      console.warn('[guest-chat] counter bump failed (fail-closed)', scrubErr(chatCountErr, 120))
      return res.status(429).json({ error: 'rate_limited' })
    }
    if (typeof chatCount !== 'number') {
      console.error('[guest-chat] bump_api_counter returned non-numeric - brake inactive', typeof chatCount)
    } else if (chatCount > CHAT_HOURLY_LIMIT) {
      if (chatCount === CHAT_HOURLY_LIMIT + 1) {
        try {
          await sendNtfy({
            title: 'Bemgu spend alert: guest-chat',
            message:
              `Feature: Guest AI chat (/api/guest-chat)\n` +
              `Host ${apt.host_id} hit ${chatCount} chat calls this hour (limit ${CHAT_HOURLY_LIMIT}).\n` +
              `GROUNDED gemini-2.5-flash on GEMINI_API_KEY_CHAT - the dearest call in the system.\n` +
              `DISABLE if needed: GEMINI_API_KEY_CHAT = project gen-lang-client-0221179352 (guest-chat only).\n` +
              `ACTION: block this host in Supabase. Vercel logs: /api/guest-chat`,
            priority: 'high',
          })
        } catch (e) {
          console.warn('[guest-chat] alarm failed (non-fatal)', scrubErr(e, 120))
        }
      }
      return res.status(429).json({ error: 'rate_limited' })
    }
  }

  const apiKey = process.env.GEMINI_API_KEY_CHAT || process.env.GEMINI_API_KEY
  if (!apiKey) { console.error('[guest-chat] no Gemini key set'); return res.status(500).json({ error: 'chat_unavailable' }) }

  const { data: hostRow } = await supabase.from('hosts').select('brand_name').eq('id', apt.host_id).maybeSingle()
  const brandName = hostRow?.brand_name || 'your host'

  const systemInstruction = await buildGuestSystemInstruction(supabase, apt, access, brandName)

  const userMessage = message.slice(0, MAX_MESSAGE)
  // Filter valid roles first, then cap — so valid turns are never evicted by invalid entries.
  const mapped = (Array.isArray(history) ? history : [])
    .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .slice(-MAX_HISTORY)
    .map((h: any) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, MAX_MESSAGE) }] }))
  while (mapped.length && mapped[0].role !== 'user') mapped.shift() // contents must start with a user turn
  const contents = [...mapped, { role: 'user', parts: [{ text: userMessage }] }]

  const ai = new GoogleGenAI({ apiKey })
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 1500))
      // Per-attempt AbortController: at 20s the in-flight HTTP request to Google is torn
      // down, not merely abandoned as the previous Promise.race did (which left a detached
      // request running to completion while the loop fired its retry). Mirrors the pattern
      // in _lib/city-events.ts.
      //
      // NOT A SPEND CAP - do not restate it as one. The SDK is explicit
      // (@google/genai genai.d.ts): "AbortSignal is a client-only operation. Using it to
      // cancel an operation will not cancel the request in the service. You will still be
      // charged usage for any applicable operations." So this is a COST REDUCER (expected
      // value), not a ceiling: the retry still fires regardless, so 40 counter units remain
      // up to 80 request attempts. Quote the brake in ATTEMPTS x retry factor, never in
      // billed generations.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      try {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }] as any,
            thinkingConfig: { thinkingBudget: 0 } as any,
            maxOutputTokens: 2048,
            abortSignal: controller.signal,
          },
        })
        const reply = (response.text || '').replace(/\*\*/g, '').trim()
        if (reply) return res.status(200).json({ reply })
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      const msg = scrubErr(e, 120)
      console.warn(`[guest-chat] attempt ${attempt} failed — ${msg}`)
    }
  }
  return res.status(500).json({ error: 'chat_failed' })
}
