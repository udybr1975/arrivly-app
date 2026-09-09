import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Public counter for the Founding Hosts programme. GET only, no auth.
 *
 * RETURNS TWO INTEGERS AND A BOOLEAN AND NOTHING ELSE — `{ remaining, limit, closed }`. No host
 * data of any kind: not an id, not a count of hosts, not a name, not a date. It also takes no
 * input at all — no query, no body, no path segment — so the response is identical for every
 * caller and there is nothing to enumerate with. The landing page is anonymous, and anon cannot
 * read `hosts`, so both numbers are computed with the service role.
 *
 * ALL FOUR SQL FUNCTIONS WERE CHECKED AT THE LIVE ACL, NOT ASSUMED — `founding_places_limit`,
 * `founding_places_held`, `founding_places_remaining` and `claim_founding_place`. Each has
 * `proconfig {search_path=public}` and `proacl {postgres=X/postgres, service_role=X/postgres}`:
 * no anon, no authenticated, and no PUBLIC (`=X/`) entry. That last one matters most for
 * BEHAVIOURALLY VERIFIED, not merely read: a second call for a host who already holds a place
 * returns claimed=true, newly_claimed=FALSE, and does NOT re-stamp founding_at. That property
 * is what makes the retry path safe — a transient `founding_check_failed` deliberately leaves
 * the offer retryable, and the retry must not consume a second place or move the host's
 * programme date. (The probe stamped a test host and was reverted to its prior NULL; is_test
 * hosts are excluded from the count, so no real place was ever involved.)
 *
 * `claim_founding_place(p_host_id uuid)`, which takes the host id as a PARAMETER rather than
 * deriving it from auth.uid() — anon-executable, it would let anyone burn all 50 places or
 * stamp founding_at on another host. **A future DROP + CREATE (rather than CREATE OR REPLACE)
 * resets the ACL to Supabase's defaults and silently re-grants EXECUTE via PUBLIC. Re-verify
 * after any change to these functions.**
 *
 * THE COUNTING RULE LIVES IN SQL, NOT HERE, AND THAT IS THE POINT. `founding_places_held()` is
 * the single definition shared by this endpoint and by `claim_founding_place()`, so the number
 * a visitor sees and the number the claim actually enforces cannot drift apart. A second copy
 * of the rule in TypeScript is exactly the defect that would let the page advertise a place
 * that the server then refuses.
 *
 * FAILS SOFT, and the direction is deliberate: on ANY error this returns `remaining: null`
 * rather than a number. The landing page renders the section WITHOUT a count in that case —
 * showing no number is honest, showing a wrong number is not, and defaulting to 50 would
 * advertise places that may not exist.
 *
 * Edge-cached for 60s as the primary load protection (same shape as public-pricing.ts), with a
 * per-instance limiter as a lightweight backstop. The cache means the counter can lag reality
 * by up to a minute; the claim is still authoritative and race-safe server-side, so the worst
 * case is a visitor seeing "3 places left" and being told at checkout that the programme just
 * filled — which the flow handles by falling back to the normal plan rather than failing.
 */

// Best-effort, per-instance rate limiter (mirrors public-pricing.ts / guest-availability.ts).
// Serverless spreads requests across instances with separate memories, so this is a backstop,
// not a hard cross-instance cap — the edge cache is what actually absorbs load here.
const RL_MAX = 60
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const now = Date.now()
  if (rateLimited(clientIp(req), now)) {
    return res.status(429).json({ error: 'rate_limited' })
  }

  // THE FAILURE PATHS SET A SHORT CACHE, THE SUCCESS PATH THE FULL 60s. Caching a transient
  // failure for a minute (plus two of stale-while-revalidate) would blank the counter for ~3
  // minutes over one hiccup, which is a long time on a page whose whole job this week is to
  // show a number.
  const cacheOk = 'public, s-maxage=60, stale-while-revalidate=120'
  const cacheFail = 'public, s-maxage=5'

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    // Unknown, not zero and not fifty. The page shows the section with no number.
    res.setHeader('Cache-Control', cacheFail)
    return res.status(200).json({ remaining: null, limit: null, closed: false })
  }

  try {
    const db = createClient(supabaseUrl, serviceKey)
    const [remainingRes, limitRes] = await Promise.all([
      db.rpc('founding_places_remaining'),
      db.rpc('founding_places_limit'),
    ])

    // TOLERANT OF A NUMERIC STRING, and that is not defensive padding. PostgREST can surface an
    // integer as a string depending on the type it resolves; a strict `typeof === 'number'`
    // guard would then fail on EVERY request, the counter would never appear, and — because
    // this endpoint deliberately logs nothing — nothing anywhere would say so. A silent,
    // permanent, invisible failure is exactly the shape worth one extra coercion.
    const num = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      return Number.isFinite(n) ? n : null
    }

    const remainingRaw = remainingRes.error ? null : num(remainingRes.data)
    // THE CAP COMES FROM SQL, not from a second copy in the page. founding_places_limit() is
    // the same function the claim enforces, so raising the programme size in one place cannot
    // leave the headline saying 50 while the counter says 60.
    const limitRaw = limitRes.error ? null : num(limitRes.data)

    if (remainingRaw === null) {
      res.setHeader('Cache-Control', cacheFail)
      return res.status(200).json({ remaining: null, limit: limitRaw, closed: false })
    }

    const remaining = Math.max(0, Math.floor(remainingRaw))
    res.setHeader('Cache-Control', cacheOk)
    return res.status(200).json({
      remaining,
      limit: limitRaw === null ? null : Math.max(0, Math.floor(limitRaw)),
      closed: remaining === 0,
    })
  } catch {
    // Deliberately no error detail in the response and nothing logged from the error object —
    // this endpoint is public and its only job is a number.
    res.setHeader('Cache-Control', cacheFail)
    return res.status(200).json({ remaining: null, limit: null, closed: false })
  }
}
