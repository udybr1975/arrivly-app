import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const MODEL = 'gemini-2.5-flash'

const EXTRAS_CATEGORIES = ['Parking', 'Recycling & Bins', 'Appliances', 'Transport', 'Amenities', 'Safety', 'Good to know']

const SYSTEM_PROMPT =
  'You are a property information organiser. Split the provided property info text into the following fixed categories: ' +
  EXTRAS_CATEGORIES.join(', ') + '. ' +
  'Output ONLY a JSON array of { "category": string, "content": string } objects — one object per category that has relevant content. ' +
  'Merge multiple items for the same category into that one content string as short newline-separated lines. ' +
  'category MUST be exactly one of the listed categories; anything that does not fit goes under "Good to know". ' +
  'Do NOT include WiFi, Check-in, or House Rules content — skip it entirely. ' +
  'Keep content concise and guest-friendly. ' +
  'Output the raw JSON array only, no other text, no code fences.'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  if (!req.body) return res.status(400).json({ error: 'content is required' })

  const { apartmentId, content } = req.body as { apartmentId?: string; content?: string }
  if (!apartmentId || typeof apartmentId !== 'string') {
    return res.status(400).json({ error: 'apartmentId is required' })
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }
  if (content.trim().length > 8000) return res.status(400).json({ error: 'content too long' })

  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: apt } = await admin
    .from('apartments')
    .select('id')
    .eq('id', apartmentId)
    .eq('host_id', authData.user.id)
    .maybeSingle()
  if (!apt) return res.status(403).json({ error: 'forbidden' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'AI not configured' })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ai = new GoogleGenAI({ apiKey })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 10000)
    })

    const generatePromise = ai.models.generateContent({
      model: MODEL,
      contents: content.trim(),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 } as any,
        maxOutputTokens: 2048,
      },
    })

    const response = await Promise.race([generatePromise, timeoutPromise])
    const raw = response.text ?? ''

    let parsed: unknown
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[bulk-import] JSON parse failed — raw:', raw.slice(0, 200))
      return res.status(502).json({ error: 'parse_failed' })
    }

    if (!Array.isArray(parsed)) {
      console.error('[bulk-import] response is not an array')
      return res.status(502).json({ error: 'parse_failed' })
    }

    const valid = (parsed as any[]).filter(
      item =>
        item &&
        typeof item === 'object' &&
        typeof item.category === 'string' &&
        EXTRAS_CATEGORIES.includes(item.category) &&
        typeof item.content === 'string' &&
        item.content.trim()
    ) as { category: string; content: string }[]

    if (valid.length === 0) {
      return res.status(200).json({ categories: [] })
    }

    await admin
      .from('apartment_details')
      .delete()
      .eq('apartment_id', apartmentId)
      .in('category', EXTRAS_CATEGORIES)

    const rows = valid.map(item => ({
      apartment_id: apartmentId,
      category: item.category,
      content: item.content.trim(),
      is_private: false,
    }))
    const { error: insertErr } = await admin.from('apartment_details').insert(rows)
    if (insertErr) {
      console.error('[bulk-import] insert failed:', insertErr.message)
      return res.status(500).json({ error: 'save_failed' })
    }

    const categories = valid.map(item => item.category)
    return res.status(200).json({ categories })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 120)
    console.error('[bulk-import] generateContent failed —', msg)
    return res.status(502).json({ error: 'rewrite failed' })
  } finally {
    clearTimeout(timer!)
  }
}
