import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { geocodeAddress } from './_lib/geo.js'
import { sendNtfy } from './_lib/ntfy.js'
import { scrubErr } from './_lib/scrub.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const { address } = req.body as { address?: string }
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'address is required' })
  }

  const trimmed = address.trim()
  if (trimmed.length > 250) return res.status(400).json({ error: 'address too long' })

  // SPEND BRAKE. A brake is UNFINISHED until its key is in cron-spend-audit's ROLLING_LIMITS —
  // unlisted endpoints are ignored by BOTH detectors, so the 429 would fire while nothing
  // alarmed. 'geocode' is registered there at 3x this cap.
  //
  // CALLER-KEYED: the bump is keyed on the getUser-verified JWT subject, so the named host
  // really is the spender and "block this host" is correct remediation.
  //
  // THE CHEAPEST DOOR ONTO THE LOCATIONIQ POOL, which is why this matters more than its one
  // call per request suggests. That pool is FLEET-WIDE (~5,000/day) and also backs address
  // save, the guide places leg and host picks — so exhausting it here degrades far more than
  // this endpoint. Unlike generate-host-picks this route takes NO apartment id and reads NO
  // apartment-scoped data: it geocodes an arbitrary 250-char string, so before this brake any
  // authenticated host could spend the pool without touching a property at all.
  //
  // 30/hour, not 10: this is a per-LOOKUP endpoint, not a per-document one. The property
  // editor geocodes once per address save and once per candidate "relocate" click, so a host
  // correcting a batch of picks legitimately makes many more calls than a host pasting one
  // manual. 30 still bounds the pool at a small fraction of a day.
  const GEOCODE_HOURLY_LIMIT = 30
  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: hourCount, error: counterErr } = await admin.rpc('bump_api_counter', {
    p_host_id: authData.user.id,
    p_endpoint: 'geocode',
  })
  if (counterErr) {
    // FAIL CLOSED. The blocked behaviour is the free fallback — the host saves the property
    // without coordinates, or leaves the pick where it is. Fail-open is indefensible when the
    // fallback costs nothing: it would spend the uncapped fleet pool during exactly the burst
    // that broke the counter.
    console.warn('[geocode] counter bump failed (fail-closed)', scrubErr(counterErr, 120))
    return res.status(503).json({ error: 'busy' })
  }
  if (typeof hourCount !== 'number') {
    console.warn('[geocode] counter returned a non-number (fail-closed)')
    return res.status(503).json({ error: 'busy' })
  }
  if (hourCount > GEOCODE_HOURLY_LIMIT) {
    // Alert INSIDE the over-cap branch and on STRICT EQUALITY, so it is one-shot: a host held
    // at the cap must not be able to fire an alert per request.
    if (hourCount === GEOCODE_HOURLY_LIMIT + 1) {
      // AWAITED, not fire-and-forget: an un-awaited fetch in a serverless function can be
      // killed when the response returns, which is exactly when this one is sent.
      await sendNtfy({
        title: 'Bemgu — geocode hourly cap hit',
        message:
          `Host ${authData.user.id} exceeded ${GEOCODE_HOURLY_LIMIT}/h on /api/geocode.\n` +
          `CALLER-KEYED: this host is the spender (JWT subject), so blocking them is ` +
          `correct remediation.\n` +
          `REVOKE + ROTATE if abuse is confirmed: LOCATIONIQ_API_KEY — shared with address ` +
          `save, guide places and host picks.`,
        priority: 'high',
      }).catch(() => {})
    }
    return res.status(429).json({ error: 'rate_limited' })
  }

  const coords = await geocodeAddress(trimmed)
  if (coords) return res.status(200).json(coords)
  return res.status(200).json({ error: 'Address not found' })
}
