import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { resolveGuestAccess, buildGuestSystemInstruction } from './_lib/guest-access.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MODEL = 'gemini-2.5-flash'
const MAX_MESSAGE = 1000
const MAX_HISTORY = 10
const MAX_RETRIES = 2

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { apartmentId, token, message, history } = (req.body ?? {}) as {
    apartmentId?: string; token?: string | null; message?: string; history?: any[]
  }
  if (!apartmentId || typeof apartmentId !== 'string') return res.status(400).json({ error: 'apartmentId required' })
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { console.error('[guest-chat] GEMINI_API_KEY not set'); return res.status(500).json({ error: 'chat_unavailable' }) }

  // Authoritative apartment from DB; client is trusted only for the id + token.
  const { data: apt } = await supabase
    .from('apartments')
    .select('id, name, city, country, neighborhood, host_id, is_visible')
    .eq('id', apartmentId)
    .maybeSingle()
  if (!apt || apt.is_visible === false) return res.status(404).json({ error: 'not_found' })

  const { data: hostRow } = await supabase.from('hosts').select('brand_name').eq('id', apt.host_id).maybeSingle()
  const brandName = hostRow?.brand_name || 'your host'

  const cleanToken = typeof token === 'string' && token !== 'null' && token.trim() ? token.trim() : null
  const access = await resolveGuestAccess(supabase, apt.id, cleanToken)
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
