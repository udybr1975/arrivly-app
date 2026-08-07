import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { reverseGeocode } from './_lib/geo.js'

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
