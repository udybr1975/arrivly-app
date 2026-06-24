import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { resolveGuestAccess, buildGuestSystemInstruction } from './_lib/guest-access.js'

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
    .select('id, name, city, country, neighborhood, host_id, is_visible')
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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { console.error('[guest-chat] GEMINI_API_KEY not set'); return res.status(500).json({ error: 'chat_unavailable' }) }

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
      let timer!: ReturnType<typeof setTimeout>
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000) })
        const gen = ai.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }] as any,
            thinkingConfig: { thinkingBudget: 0 } as any,
            maxOutputTokens: 2048,
          },
        })
        const response = await Promise.race([gen, timeout])
        const reply = (response.text || '').replace(/\*\*/g, '').trim()
        if (reply) return res.status(200).json({ reply })
      } finally {
        clearTimeout(timer!)
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
      console.warn(`[guest-chat] attempt ${attempt} failed — ${msg}`)
    }
  }
  return res.status(500).json({ error: 'chat_failed' })
}
