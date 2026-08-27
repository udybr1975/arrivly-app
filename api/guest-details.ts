import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGuestAccess } from './_lib/guest-access.js'

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9-]{4,32}$/

const svc = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// --- Best-effort in-memory rate limiter (per-instance only; not shared across Lambdas) ---
// Byte-identical IN ITS EXECUTABLE PORTION to the limiter in guest-state.ts,
// guest-bootstrap.ts and welcome.ts — the three siblings this endpoint is called alongside.
// It was the ONLY one of the four without one, which is the wrong way round: it is also
// the only one that returns PRIVATE
// apartment_details rows (door codes, WiFi, check-in instructions).
//
// THIS IS A BRUTE-FORCE-COST CONTROL, NOT AN ACCESS CONTROL, and the distinction is the whole
// point. Access is decided by resolveGuestAccess: unless the token resolves to a
// confirmed/completed booking that is ALSO in dates, the caller gets 403 and no rows — at any
// request rate. (One carve-out, deliberate: guest-access.ts skips the date bound for the
// is_public_demo apartment, whose rows are published on purpose.) The limiter grants nothing
// and withholds nothing; it only prices GUESSING.
//
// AND THE PRICE MATTERS MORE THAN TOKEN_RE SUGGESTS, so do not read the regex as the entropy.
// TOKEN_RE is /^[A-Za-z0-9-]{4,32}$/, which is a LENGTH BOUND ON ACCEPTED INPUT, not a token
// space — it accepts 4 characters. The real credential is what the minters produce: `ARR-`
// plus SIX characters from a 32-symbol alphabet — ALL THREE minters agree on that shape
// (api/create-booking.ts randomRef, api/demo-create.ts randomRef, api/_lib/ical.ts
// generateRef), i.e. 32^6 ~ 1.07e9, about 30 bits behind a KNOWN prefix.
// That is not free to guess, but it is not out of reach either, and it is exactly the regime
// where an unmetered endpoint is the problem: each probe costs only a service-role query.
// 30/60s prices that without touching a real guest, who loads this page once per stay.
//
// Compare welcome-claim, where the file records that the REAL guessing control is
// `platform_ref` entropy rather than the brake. Here the credential is WEAKER than that one,
// so the brake carries correspondingly more of the load — the same reasoning, opposite
// conclusion, and worth stating so the two are not read as saying the same thing.
//
// Per-instance only: serverless memory is NOT shared across Lambda instances, so this caps
// abuse from a single warm instance, not globally. A shared-store (Redis/Upstash) limiter is a
// future hardening option — do not oversell this.
const RL_MAX = 30
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, { count: number; windowStart: number }>()

function rateLimited(ip: string, now: number): boolean {
  const entry = rlHits.get(ip)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(ip, { count: 1, windowStart: now })
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
  // This response varies by a per-guest credential (the booking token, which unlocks
  // PRIVATE apartment_details rows), so it must never be stored by a CDN, a proxy or
  // the browser. Set BEFORE the method guard so every path carries it — there are
  // multiple return sites in this file and a future one added below would otherwise
  // ship uncovered.
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  if (rateLimited(clientIp(req), now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  const apt   = typeof req.query.apt   === 'string' ? req.query.apt.trim()   : ''
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''

  if (!apt || !UUID_RE.test(apt) || !token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'bad_request' })
  }

  const db = svc()
  try {
    const access = await resolveGuestAccess(db, apt, token)
    if (access.tier !== 'verified') return res.status(403).json({ error: 'forbidden' })

    const { data: rows, error } = await db
      .from('apartment_details')
      .select('id, category, content, is_private')
      .eq('apartment_id', apt)
      .eq('is_private', true)

    if (error) {
      console.error('[guest-details] query', error.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    return res.status(200).json({ details: rows ?? [] })
  } catch (e) {
    console.error('[guest-details] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
