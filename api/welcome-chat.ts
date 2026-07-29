import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { verifyTurnstile } from './_lib/turnstile.js'
import { withRetry } from './_lib/retry.js'

// PUBLIC concierge for the welcome page (/w/:code). Separate from api/guest-chat.ts on
// purpose: this endpoint is reachable WITHOUT a booking token, so it carries its own,
// tighter cost controls and its OWN Gemini key. It may only ever see PUBLIC material —
// never private apartment_details, WiFi, door codes, booking data or a guest name.
//
// Cost isolation is the point: it reads GEMINI_API_KEY_PUBLIC ONLY (no fallback), so
// abuse here can never exhaust the quota that verified in-stay guests depend on. Every
// request is gated by Cloudflare Turnstile (human check) + a tight per-instance IP limiter.

const MODEL = 'gemini-3.1-flash-lite'
const MAX_MESSAGE = 1000
const MAX_HISTORY_TURNS = 8
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Best-effort per-instance limiter, keyed on welcome code + IP. Deliberately tighter than
// guest-chat's 15/min because this path is public (Turnstile + this limiter are the real
// controls; the conversation bound below is only a UX/prompt-size guard).
const RL_MAX = 5
const RL_WINDOW_MS = 60_000
const RL_MAX_KEYS = 5000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
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

interface AptCtx {
  id: string
  name: string
  city: string | null
  country: string | null
  neighborhood: string | null
  street: string | null
  street_number: string | null
  welcome_show_address: boolean | null
}

// Build the PUBLIC system instruction. Uses ONLY public material: the apartment name,
// area, PUBLIC apartment_details (is_private = false), host picks, the guide, and the
// street address ONLY when welcome_show_address is true. It NEVER queries private rows.
async function buildPublicSystemInstruction(
  db: SupabaseClient,
  apt: AptCtx,
  brandName: string,
): Promise<string> {
  const [detailsRes, picksRes, guideRes] = await Promise.all([
    db.from('apartment_details').select('category, content').eq('apartment_id', apt.id).eq('is_private', false),
    db.from('host_picks').select('name, category, address, note').eq('apartment_id', apt.id).order('display_order'),
    db.from('guide_recommendations').select('categories').eq('apartment_id', apt.id).maybeSingle(),
  ])

  const details = detailsRes.data ?? []
  const detailsBlock = details.length
    ? details.map(d => `[${d.category}] ${d.content}`).join('\n')
    : 'No public apartment details on file yet.'

  const picks = picksRes.data ?? []
  const picksBlock = picks.length
    ? picks.map(p => `- ${p.name} (${p.category})${p.address ? `, ${p.address}` : ''}${p.note ? ` — ${p.note}` : ''}`).join('\n')
    : 'No host recommendations yet.'

  let guideBlock = 'No neighbourhood guide yet.'
  const cats = guideRes.data?.categories as Record<string, Array<{ name: string; address?: string; description?: string }>> | undefined
  if (cats && Object.keys(cats).length) {
    guideBlock = Object.entries(cats)
      .map(([cat, items]) =>
        `${cat}:\n` +
        (Array.isArray(items)
          ? items.map(i => `  - ${i.name}${i.address ? `, ${i.address}` : ''}${i.description ? ` — ${i.description}` : ''}`).join('\n')
          : ''))
      .join('\n')
  }

  const where = [apt.neighborhood, apt.city, apt.country].filter(Boolean).join(', ')
  const streetLine = [apt.street, apt.street_number].filter(Boolean).join(' ')
  // Address ONLY when the host opted in; otherwise it never enters the prompt.
  const addressBlock = apt.welcome_show_address === true && streetLine
    ? `ADDRESS: ${[streetLine, apt.neighborhood, apt.city, apt.country].filter(Boolean).join(', ')}`
    : ''

  return [
    `You are the friendly concierge for "${brandName}", helping a guest who has booked ${apt.name} in ${where} and is planning their trip BEFORE they arrive.`,
    ``,
    `CONTEXT: This is a PUBLIC pre-arrival visitor, not a verified in-stay guest. You have ONLY public information. You do NOT have Wi-Fi, door codes, exact entry instructions or any booking details. If asked for those, warmly explain they are waiting inside the guest page to be scanned on arrival, and that the host can help via WhatsApp — never guess or invent them.`,
    ``,
    `GROUNDING:`,
    `- For anything about THIS apartment, use ONLY the APARTMENT DATA below. If something isn't there, say you don't have it and suggest messaging the host.`,
    `- For questions about the area (things to do, restaurants, transport, sights, getting around, what to book ahead), draw on the HOST RECOMMENDATIONS and NEIGHBOURHOOD GUIDE below. Prefer the host's own picks when they fit. Help them plan an itinerary.`,
    `- You have NO live information. For places outside the apartment, never state opening hours, prices, availability, booking conditions or current events as fact — describe them in general terms instead, and tell the guest to check directly or ask the host for anything time-sensitive. (Times the host has stated in APARTMENT DATA, such as check-in and check-out, you may give as written.)`,
    ``,
    `STYLE:`,
    `- Warm, concise, conversational. Plain text only — never markdown bold or double asterisks. Keep replies short unless asked for more.`,
    ``,
    `APARTMENT DATA:`,
    addressBlock,
    detailsBlock,
    ``,
    `HOST RECOMMENDATIONS:`,
    picksBlock,
    ``,
    `NEIGHBOURHOOD GUIDE:`,
    guideBlock,
  ].join('\n')
}

// ── PROVIDER-PORTABLE model invocation ──────────────────────────────────────────
// The ONLY place Gemini specifics live (client construction, request/response shape,
// timeout + retry). A later swap to a different provider is a contained edit here.
async function callModel(systemInstruction: string, history: unknown, message: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY_PUBLIC
  if (!apiKey) throw new Error('no_public_key') // handler pre-checks; defensive
  const ai = new GoogleGenAI({ apiKey })

  const userMessage = message.slice(0, MAX_MESSAGE)
  const mapped = (Array.isArray(history) ? history : [])
    .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((h: any) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, MAX_MESSAGE) }] }))
  while (mapped.length && mapped[0].role !== 'user') mapped.shift() // contents must start with a user turn
  const contents = [...mapped, { role: 'user', parts: [{ text: userMessage }] }]

  return withRetry(
    async () => {
      let timer!: ReturnType<typeof setTimeout>
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000) })
        const gen = ai.models.generateContent({
          model: MODEL,
          contents,
          // NO Google Search grounding here — DELIBERATE. Grounding has no free-tier quota on
          // the bemgu-public-welcome project (verified: same key + model returns 200 without a
          // tools array and 429 RESOURCE_EXHAUSTED with one), so it would be paid-only. The
          // welcome page is pre-arrival planning where the cached city guide and host picks sit
          // on the same screen, so the loss is small.
          config: {
            systemInstruction,
            thinkingConfig: { thinkingBudget: 0 } as any,
            maxOutputTokens: 2048,
          },
        })
        const response = await Promise.race([gen, timeout])
        return (response.text || '').replace(/\*\*/g, '').trim()
      } finally {
        clearTimeout(timer!)
      }
    },
    { retries: 1 },
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const { code, message, history, turnstileToken } = (req.body ?? {}) as {
    code?: string; message?: string; history?: unknown; turnstileToken?: string
  }

  const cleanCode = typeof code === 'string' ? code.trim() : ''
  if (!cleanCode || !CODE_RE.test(cleanCode)) return res.status(400).json({ error: 'bad_request' })
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'bad_request' })

  // Conversation bound: > 8 turns → 400. This bounds prompt size and is a UX bound, NOT a
  // hard security control (a client can reset it); Turnstile + the IP limiter are the real
  // controls.
  if (Array.isArray(history) && history.length > MAX_HISTORY_TURNS) {
    return res.status(400).json({ error: 'history_too_long' })
  }

  // Per-instance spend cap, keyed on code + IP.
  if (rateLimited(`${cleanCode}:${clientIp(req)}`, Date.now())) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // Turnstile: verify a human on every request (existing helper; fail-closed).
  const captchaOk = await verifyTurnstile(typeof turnstileToken === 'string' ? turnstileToken : '', clientIp(req))
  if (!captchaOk) return res.status(403).json({ error: 'captcha_failed' })

  // Dedicated public key ONLY — no fallback. Unset → 503 without calling Google.
  if (!process.env.GEMINI_API_KEY_PUBLIC) {
    console.error('[welcome-chat] GEMINI_API_KEY_PUBLIC not set')
    return res.status(503).json({ error: 'unavailable' })
  }

  const db = svc()
  try {
    const { data: apt } = await db
      .from('apartments')
      .select('id, name, city, country, neighborhood, street, street_number, welcome_show_address, host_id, is_visible')
      .eq('welcome_code', cleanCode)
      .maybeSingle()
    // Uniform 403 for no-match / hidden / expired — never an enumeration oracle.
    if (!apt || apt.is_visible !== true) return res.status(403).json({ error: 'unavailable' })

    const { data: hostRow } = await db
      .from('hosts')
      .select('brand_name, subscription_status')
      .eq('id', apt.host_id)
      .maybeSingle()
    if (!hostRow || hostRow.subscription_status === 'expired') {
      return res.status(403).json({ error: 'unavailable' })
    }
    const brandName = hostRow.brand_name || 'your host'

    const systemInstruction = await buildPublicSystemInstruction(db, apt as AptCtx, brandName)

    const reply = await callModel(systemInstruction, history, message)
    if (reply) return res.status(200).json({ reply })
    return res.status(500).json({ error: 'chat_failed' })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.warn('[welcome-chat] failed —', msg)
    return res.status(500).json({ error: 'chat_failed' })
  }
}
