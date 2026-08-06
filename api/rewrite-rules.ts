import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { withRetry } from './_lib/retry.js'
import { scrubErr } from './_lib/scrub.js'
import { aiGenerate, resolveProvider } from './_lib/ai-provider.js'

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

  // PILOT: provider decides WHICH model answers. Auth, validation, the 5000-char input cap and
  // the response shape are untouched. The GEMINI_API_KEY guard moved inside the gemini branch
  // so the groq path still works once the GEMINI_* vars are deleted (pilot Step 8).
  const provider = resolveProvider('rewrite')

  try {
    let text = ''
    if (provider === 'groq') {
      // Budget parity with the gemini branch below: 2 retries (3 attempts) x 10s.
      text = await aiGenerate('rewrite', {
        system: SYSTEM_PROMPT,
        prompt: trimmed,
        maxTokens: 1500,
        retries: 2,
        timeoutMs: 10000,
      })
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) return res.status(500).json({ error: 'AI not configured' })
      const ai = new GoogleGenAI({ apiKey })

      const generate = async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        try {
          return await ai.models.generateContent({
            model: MODEL,
            contents: trimmed,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              thinkingConfig: { thinkingBudget: 0 } as any,
              maxOutputTokens: 1500,
              abortSignal: controller.signal,
            },
          })
        } finally {
          clearTimeout(timer)
        }
      }

      const response = await withRetry(generate, { retries: 2, baseDelayMs: 600 })
      text = response.text ?? ''
    }

    // Unchanged fallback: an empty generation returns the host's own input, never an error.
    const result = text.trim() || trimmed
    return res.status(200).json({ result })
  } catch (e) {
    const msg = scrubErr(e)
    console.error('[rewrite-rules] generateContent failed —', msg)
    return res.status(502).json({ error: 'rewrite failed' })
  }
}
