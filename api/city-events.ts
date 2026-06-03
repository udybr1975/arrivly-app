import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MODEL = 'gemini-2.5-flash'
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId } = (req.body ?? {}) as { apartmentId?: string }
  if (!apartmentId || typeof apartmentId !== 'string') return res.status(400).json({ error: 'apartmentId required' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { console.error('[city-events] GEMINI_API_KEY not set'); return res.status(200).json({ error: true }) }

  // Authoritative city from DB — never trust a client-supplied city.
  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, city, country, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (aptErr || !apt || apt.is_visible === false || !apt.city) return res.status(200).json({ error: true })

  const now = new Date()
  const until = new Date(now); until.setDate(now.getDate() + 7)
  const today = fmt(now)
  const untilStr = fmt(until)
  const city = (apt.city ?? '').slice(0, 80)
  const country = (apt.country ?? '').slice(0, 80)
  const place = country ? `${city}, ${country}` : city

  const prompt =
    `Today is ${today}. Use web search to find 5-7 real, specific events happening in ${place} ` +
    `between ${today} and ${untilStr} — the next 7 days only. ` +
    `Include concerts, exhibitions, markets, festivals, sports, theatre or nightlife with real venues and dates. ` +
    `Do NOT include past events, generic "things to do", or anything you cannot verify is scheduled in this window. ` +
    `Return ONLY raw JSON — no markdown, no code fences — shaped exactly as: ` +
    `{"week":"${today} – ${untilStr}","categories":[{"name":"This week","events":[{"title":"","venue":"","date":"","desc":"","price":"Free or €XX"}]}]}. ` +
    `Each event: title (name), venue (place), date (day/date within the window), desc (one short sentence), price ("Free" or e.g. "€20"). ` +
    `If you cannot verify any real events, return {"week":"${today} – ${untilStr}","categories":[]}.`

  const ai = new GoogleGenAI({ apiKey })
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 2000))
      let timer!: ReturnType<typeof setTimeout>
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 30000) })
        const gen = ai.models.generateContent({
          model: MODEL,
          contents: prompt,
          // googleSearch grounding: cannot be combined with responseMimeType JSON,
          // so we parse fenced text defensively (same pattern as Anna's grounded admin events).
          config: { tools: [{ googleSearch: {} }] as any, thinkingConfig: { thinkingBudget: 0 } as any },
        })
        const response = await Promise.race([gen, timeout])
        const raw = (response.text || '').replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.categories)) {
          return res.status(200).json(parsed)
        }
      } finally {
        clearTimeout(timer!)
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
      console.warn(`[city-events] attempt ${attempt} failed — ${msg}`)
    }
  }
  return res.status(200).json({ error: true })
}
