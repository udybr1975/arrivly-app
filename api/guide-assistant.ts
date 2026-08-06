import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { scrubErr } from './_lib/scrub.js'
import { aiGenerate, isAiConfigError, resolveProvider } from './_lib/ai-provider.js'
import { GUIDE_MODULES } from '../src/guide/content.js'

// "Ask Arrivly" — a host-authenticated, corpus-grounded help assistant. Answers ONLY
// from the static Guide content (GUIDE_MODULES, which carries NO secrets and NO
// per-host data). Mirrors guest-chat's hardening (timeout, retries, key-scrubbed
// logs, per-instance rate limit) but with host-only auth and NO web tools.
const MODEL = 'gemini-2.5-flash'
const MAX_MESSAGE = 600
const MAX_HISTORY = 8
const MAX_RETRIES = 2

// Static corpus → system instruction, built once at module load (no per-request cost).
const GUIDE_CORPUS = GUIDE_MODULES.map((m) => {
  const tag = m.status === 'coming-soon' ? ' [NOT YET AVAILABLE — coming soon, never promise it]' : ''
  return `## ${m.title}${tag}\n${m.summary}\n\n${m.body}`
}).join('\n\n---\n\n')

const SYSTEM_INSTRUCTION = `You are Bemgu's in-app help assistant for hosts. Answer ONLY from the guide content provided below. If the answer isn't in the guide, say you can only help with Bemgu and point the host to the most relevant section or to Support — do not guess. Never invent app behaviour and never give general short-term-rental advice. Describe any "coming soon" feature as not yet available; never promise it. Keep answers concise, warm, and practical.

GUIDE CONTENT:
${GUIDE_CORPUS}`

// Best-effort, per-instance rate limiter — a spend cap on the authenticated Gemini
// path. Keyed by hostUserId+IP.
const RL_MAX = 20
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

  // AUTH: host-only. Resolve the user from the Bearer token via an anon client.
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const { message, history } = (req.body ?? {}) as { message?: string; history?: any[] }
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' })

  // Spend cap on the authenticated path.
  if (rateLimited(`${authData.user.id}:${clientIp(req)}`, Date.now())) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // PILOT: provider decides WHICH model answers. The 20/min per-instance rate limit above,
  // the auth gate, the corpus-only system instruction and every response shape are untouched.
  const provider = resolveProvider('guide_assistant')

  const userMessage = message.slice(0, MAX_MESSAGE)
  // Filter valid roles first, then cap — so valid turns are never evicted by invalid entries.
  // Kept provider-neutral (role + text) and shaped per provider below; the filter → cap →
  // drop-leading-non-user sequence is unchanged, only the final shaping differs.
  const turns = (Array.isArray(history) ? history : [])
    .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .slice(-MAX_HISTORY)
    .map((h: any) => ({ role: h.role as 'user' | 'assistant', text: String(h.text).slice(0, MAX_MESSAGE) }))
  while (turns.length && turns[0].role !== 'user') turns.shift() // must start with a user turn

  if (provider === 'groq') {
    // aiGenerate carries its own withRetry (transient-only), so there is no outer retry loop
    // here; the failure shape below is identical to the gemini path's exhausted-retries exit.
    try {
      // Budget parity with the gemini loop below: MAX_RETRIES=2 attempts x 20s -> retries 1.
      const raw = await aiGenerate('guide_assistant', {
        system: SYSTEM_INSTRUCTION,
        messages: turns.map(t => ({ role: t.role, content: t.text })),
        prompt: userMessage,
        maxTokens: 1024,
        retries: 1,
        timeoutMs: 20000,
      })
      const reply = raw.replace(/\*\*/g, '').trim()
      if (reply) return res.status(200).json({ reply })
    } catch (e) {
      // A missing key is a CONFIG fault, not a model failure — same split, and the same two
      // HTTP bodies, as the gemini path's `assistant_unavailable` vs `assistant_failed`.
      if (isAiConfigError(e)) {
        console.error('[guide-assistant] no Groq key set')
        return res.status(500).json({ error: 'assistant_unavailable' })
      }
      console.warn(`[guide-assistant] groq attempt failed — ${scrubErr(e, 120)}`)
    }
    return res.status(500).json({ error: 'assistant_failed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[guide-assistant] no Gemini key set')
    return res.status(500).json({ error: 'assistant_unavailable' })
  }

  const contents = [
    ...turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const ai = new GoogleGenAI({ apiKey })
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) await new Promise((r) => setTimeout(r, attempt * 1500))
      let timer!: ReturnType<typeof setTimeout>
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000) })
        const gen = ai.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingBudget: 0 } as any,
            maxOutputTokens: 1024,
          },
        })
        const response = await Promise.race([gen, timeout])
        const reply = (response.text || '').replace(/\*\*/g, '').trim()
        if (reply) return res.status(200).json({ reply })
      } finally {
        clearTimeout(timer!)
      }
    } catch (e) {
      const msg = scrubErr(e, 120)
      console.warn(`[guide-assistant] attempt ${attempt} failed — ${msg}`)
    }
  }
  return res.status(500).json({ error: 'assistant_failed' })
}
