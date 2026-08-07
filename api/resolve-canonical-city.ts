import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { reverseGeocode } from './_lib/geo.js'
import { sendNtfy } from './_lib/ntfy.js'

// Resolve an apartment's coordinates into a canonical city identity and store it.
//
// WHY THIS IS SERVER-SIDE AND THE CLIENT NEVER SUPPLIES THE KEY:
// `canonical_city_key` selects WHICH cache row an apartment reads. In commit 2 each DISTINCT key
// costs 4 Tavily credits against a FLEET-WIDE pool of 1,000 per month. A client-supplied key
// would therefore let one host mint unbounded distinct keys and spend every other host's
// allowance — a cross-tenant spend vector, not just a data-quality problem. The client sends an
// apartment id and nothing else; the key is derived here from coordinates the server reads back
// from the database.
//
// This endpoint writes ONLY the five canonical_* columns. It never touches apartments.city /
// country / lat / lng — those are the host's typed display values and are out of scope.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const { apartmentId } = (req.body ?? {}) as { apartmentId?: unknown }
  if (typeof apartmentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apartmentId)) {
    return res.status(400).json({ error: 'apartmentId must be a uuid' })
  }

  const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // OWNERSHIP IS ENFORCED HERE, against the JWT-derived user id. A host_id from the body is
  // never read or trusted; a foreign apartment id simply matches zero rows and 404s.
  const { data: apt, error: aptErr } = await db
    .from('apartments')
    .select('id, lat, lng, canonical_city_key, canonical_resolved_at')
    .eq('id', apartmentId)
    .eq('host_id', userId)
    .maybeSingle()
  if (aptErr || !apt) return res.status(404).json({ error: 'Not found' })

  if (typeof apt.lat !== 'number' || typeof apt.lng !== 'number') {
    // Not an error: an address that never geocoded simply has nothing to resolve from.
    return res.status(200).json({ resolved: false, reason: 'no_coordinates' })
  }

  // ── Cross-instance per-host cap on the LocationIQ reverse-geocode spend ───────────────────
  //
  // WHY THIS ENDPOINT NEEDS ONE AT ALL: LocationIQ's 5,000/day free tier is a FLEET-WIDE pool,
  // and the SAME key serves forward geocoding — the address save itself, guide place lookups and
  // host picks. So a host looping address saves does not just waste their own allowance; they can
  // degrade address lookup for EVERY tenant. That makes this the last unmetered surface reaching
  // a shared vendor pool, even though there is no AI spend on this path.
  //
  // LIMIT 20/HOUR, sized against real usage rather than picked round: a resolve fires only from a
  // save that CHANGED the coordinates, so ordinary editing never reaches double figures — even a
  // host setting up several properties back to back stays far below it. 20 leaves normal
  // multi-property setup completely unimpeded while bounding a determined loop to 480/day, under
  // a tenth of the fleet-wide daily pool.
  //
  // CALLER-KEYED: the ownership check above precedes this bump, so `userId` (JWT-derived, and
  // proven to own this apartment by the `.eq('host_id', userId)` filter) really is the caller.
  // That is what makes the alarm's "block this host" ACTION line correct here — unlike
  // api/city-events.ts, whose public counter is victim-keyed. Do not converge the three.
  //
  // PLACED AFTER the no-coordinates guard and IMMEDIATELY BEFORE the vendor call: a blocked call
  // spends no LocationIQ request, and a call that was never going to reach the vendor (no
  // coordinates) is not charged a unit it did not cost.
  const RESOLVE_CITY_LIMIT = 20
  {
    const { data: rcCount, error: rcCountErr } = await db.rpc('bump_api_counter', {
      p_host_id: userId,
      p_endpoint: 'resolve-canonical-city',
    })
    if (rcCountErr) {
      // FAIL CLOSED, but SOFTLY. This endpoint is fire-and-forget from PropertySetup, so it must
      // never be able to fail a save or surface an error to the host — hence a 200 with the
      // existing shape rather than the 429 refresh-events.ts returns. A distinct reason keeps a
      // brake block diagnosable in logs instead of blurring into 'unresolved' (a vendor failure).
      console.warn('[resolve-canonical-city] counter bump failed (fail-closed) -', rcCountErr.message?.slice(0, 120))
      return res.status(200).json({ resolved: false, reason: 'busy' })
    }
    if (typeof rcCount !== 'number') {
      console.error('[resolve-canonical-city] bump_api_counter returned non-numeric - brake inactive', typeof rcCount)
    } else if (rcCount > RESOLVE_CITY_LIMIT) {
      if (rcCount === RESOLVE_CITY_LIMIT + 1) {
        // fa8fa32 RULE: remediation text migrates with its surface. The vendor here is
        // LOCATIONIQ — naming Groq or Tavily would be actively harmful, since revoking Groq stops
        // every AI surface and would do nothing about this. resolveProvider() is deliberately NOT
        // called: it describes the AI provider, and there is no AI on this path.
        //
        // MEASURED 466 chars against sendNtfy's 500-char slice (34 spare), ASCII-only, no emoji
        // (a non-ASCII byte throws ByteString on Vercel). This is a PROOF, not a sample: the alarm
        // fires only at `=== LIMIT + 1`, so the count is always 2 digits and the host id always a
        // 36-char UUID — worst case IS typical case, with no variable-length field. Re-measure
        // before adding any line; the ACTION line is last and would be the part silently cut.
        try {
          await sendNtfy({
            title: 'Bemgu spend alert: canonical city resolve',
            message:
              `Feature: Canonical city resolve (/api/resolve-canonical-city)\n` +
              `Host ${userId} hit ${rcCount} resolves this hour (limit ${RESOLVE_CITY_LIMIT}).\n` +
              `LocationIQ reverse geocoding; the 5,000/day free tier is FLEET-WIDE.\n` +
              `LOCATIONIQ_API_KEY is SHARED with forward geocoding (address save, guide places, host picks) - revoking it breaks address lookup everywhere. CHECK QUOTA FIRST at locationiq.com.\n` +
              `ACTION: block this host in Supabase. Vercel logs: /api/resolve-canonical-city`,
            priority: 'high',
          })
        } catch (e) {
          console.warn('[resolve-canonical-city] alarm failed (non-fatal)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
        }
      }
      return res.status(200).json({ resolved: false, reason: 'rate_limited' })
    }
  }

  const canonical = await reverseGeocode(apt.lat, apt.lng)
  if (!canonical) {
    // WRITE NOTHING. A failed resolve must leave whatever is already stored untouched — blanking
    // a previously-good key on a transient LocationIQ failure would silently move the apartment
    // off its city's cache row in commit 2.
    return res.status(200).json({ resolved: false, reason: 'unresolved' })
  }

  const { error: upErr } = await db
    .from('apartments')
    .update({
      canonical_city: canonical.city,
      canonical_country: canonical.country,
      canonical_country_code: canonical.countryCode,
      canonical_city_key: canonical.cityKey,
      canonical_resolved_at: new Date().toISOString(),
    })
    .eq('id', apartmentId)
    .eq('host_id', userId) // scope the WRITE as well as the read
  if (upErr) return res.status(500).json({ error: 'Update failed' })

  return res.status(200).json({
    resolved: true,
    cityKey: canonical.cityKey,
    city: canonical.city,
    country: canonical.country,
  })
}
