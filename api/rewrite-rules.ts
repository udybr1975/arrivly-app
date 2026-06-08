import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT =
  "You rewrite short-term rental house rules to sound warm, friendly and welcoming to a guest. " +
  "Write in flowing prose — no bullet points, no numbered lists, no markdown, no headings. " +
  "Address the guest directly as 'you'. Keep it concise: one short paragraph, two at most. " +
  "Preserve every actual rule and constraint from the input exactly — do not add, remove, soften, or invent rules. " +
  "Write in the SAME language as the input. " +
  "Output only the rewritten text, with no preamble, labels, or quotation marks."

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  if (!req.body) return res.status(400).json({ error: 'rawRules is required' })

  const { rawRules } = req.body as { rawRules?: string }
  if (!rawRules || typeof rawRules !== 'string' || !rawRules.trim()) {
    return res.status(400).json({ error: 'rawRules is required' })
  }

  const trimmed = rawRules.trim()
  if (trimmed.length > 5000) return res.status(400).json({ error: 'rules too long' })

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
      contents: trimmed,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        thinkingConfig: { thinkingBudget: 0 } as any,
        maxOutputTokens: 1500,
      },
    })

    const response = await Promise.race([generatePromise, timeoutPromise])
    const result = response.text?.trim() || trimmed

    return res.status(200).json({ result })
  } catch (e) {
    // TEMPORARY DIAGNOSTIC — remove after root-causing the Gemini 502.
    // Value-first log lines so they survive Vercel log truncation. Key-scrubbed.
    const scrub = (s: string): string =>
      s
        .replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza_REDACTED')
        .replace(/key=[^&\s]+/gi, 'key=REDACTED')
    const err = e as any
    const status = String(err?.status ?? err?.code ?? '')
    const name = String(err?.name ?? '')
    let full = ''
    try {
      full = JSON.stringify(err, Object.getOwnPropertyNames(Object(err)))
    } catch {
      full = String(err)
    }
    console.error(`GEMINIDIAG ${status || '?'} ${name || '?'} model=${MODEL}`)
    console.error('GEMINIDIAGMSG ' + scrub(String(err?.message ?? err)).slice(0, 800))
    console.error('GEMINIDIAGFULL ' + scrub(full).slice(0, 1500))
    if (err?.cause) console.error('GEMINIDIAGCAUSE ' + scrub(String(err.cause)).slice(0, 500))
    return res.status(502).json({ error: 'rewrite failed' })
  } finally {
    clearTimeout(timer!)
  }
}
