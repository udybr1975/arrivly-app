import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateGuideForApartment } from './_lib/guide.js'
import { generateGreetingBlurb } from './_lib/greeting.js'
import { scrubErr } from './_lib/scrub.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GUIDE_COOLDOWN_MS = 6 * 60 * 60 * 1000  // 6h server floor; UI shows 24h

// PostgREST parses filters as `column.operator.value`. Emitting the timestamp without
// milliseconds keeps any '.' out of the value used in the .or() filter below.
const isoNoMs = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const authClient = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
  )
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (!req.body) return res.status(400).json({ error: 'apartment_id required' })
  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, host_id, street, street_number, neighborhood, city, country, lat, lng')
    .eq('id', apartment_id)
    .maybeSingle()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  // ── Atomic per-host spend gate ─────────────────────────────────────────────────
  // GUIDE_FRESH_HOURS in PropertySetup.tsx is UI-only and is bypassed by calling this
  // endpoint directly; one run costs up to two grounded Gemini generations plus up to
  // 30 geocodes.
  //
  // The claim lives on `hosts`, NOT on guide_recommendations. An earlier version keyed it
  // to the apartment's guide row, which FK-cascades from apartments: a host could delete
  // their apartment, recreate it, and hit an ungated first-generation path in a burst.
  // A host cannot escape their own hosts row — there is no DELETE policy on hosts, the
  // id is the PK so it cannot be re-inserted, and `guide_claimed_at` is absent from the
  // authenticated column-UPDATE allowlist, so only service-role writes it.
  //
  // Burst-safety comes from this being ONE conditional UPDATE whose predicate reads the
  // SAME column the winning statement writes: under READ COMMITTED a concurrent updater
  // blocks on the host row lock, then re-evaluates the predicate against the newly
  // committed row, sees the fresh timestamp and matches zero rows. Exactly one caller
  // wins. The host row always exists (created by handle_new_user), so there is no
  // first-generation hole.
  //
  // The claim is stamped BEFORE generation, so a failed run still consumes the window —
  // deliberate, since a failing generation costs the same money as a successful one.
  //
  // SCOPE, INTENDED AND ACCEPTED: the gate is per-HOST, not per-apartment, so a host with
  // several properties can refresh ONE guide per 6h across ALL of them.
  //
  // Placed after auth + ownership so claim state is never observable to a non-owner.
  // cron-refresh-guides.ts and demo-create.ts call the library directly and bypass this.
  const nowMs = Date.now()
  const cutoffIso = isoNoMs(new Date(nowMs - GUIDE_COOLDOWN_MS))

  const { data: claimed, error: claimErr } = await supabase
    .from('hosts')
    .update({ guide_claimed_at: isoNoMs(new Date(nowMs)) })
    .eq('id', userId)
    .or(`guide_claimed_at.is.null,guide_claimed_at.lt.${cutoffIso}`)
    .select('id')

  // Fail open on an infrastructure error: a broken claim must not permanently block
  // legitimate refreshes. Logged so it is visible rather than silent.
  if (claimErr) console.error('[generate-guide] claim failed —', scrubErr(claimErr, 120))

  // ALARM, not a guard — by here the service-role UPDATE has already committed, so this cannot
  // prevent damage. It exists so that a future refactor which mis-composes the filter (e.g. by
  // moving the id predicate inside the .or(), which would drop row scoping and stamp EVERY host)
  // screams in the logs instead of silently corrupting the table.
  if (claimed && claimed.length > 1) {
    console.error('[generate-guide] CLAIM SCOPE BUG — updated rows:', claimed.length, 'expected 1')
  }

  if (!claimErr && (!claimed || claimed.length === 0)) {
    // The host row always exists, so zero rows updated means the cooldown is active.
    // Read the timestamp back only to report how long is left.
    const { data: hostRow, error: readErr } = await supabase
      .from('hosts')
      .select('guide_claimed_at')
      .eq('id', userId)
      .maybeSingle()

    if (readErr) {
      // Fail open, same reasoning as the claim error above.
      console.error('[generate-guide] claim read-back failed —', scrubErr(readErr, 120))
    } else if (hostRow?.guide_claimed_at) {
      const elapsed = nowMs - new Date(hostRow.guide_claimed_at).getTime()
      // An unparseable timestamp yields NaN and falls through to generation.
      if (Number.isFinite(elapsed) && elapsed < GUIDE_COOLDOWN_MS) {
        // Clamp to [0, cooldown] so a clock-skewed future stamp cannot report a wild wait.
        const remainingMs = Math.min(GUIDE_COOLDOWN_MS, Math.max(0, GUIDE_COOLDOWN_MS - elapsed))
        const retryAfterS = Math.ceil(remainingMs / 1000)
        res.setHeader('Retry-After', String(retryAfterS))
        return res.status(429).json({ error: 'cooldown', retry_after_s: retryAfterS })
      }
    }
    // A missing row or null/unparseable timestamp falls through and generates (fail open).
  }

  try {
    const { placeCount } = await generateGuideForApartment(supabase, {
      id: apt.id,
      street: apt.street,
      street_number: apt.street_number,
      neighborhood: apt.neighborhood,
      city: apt.city,
      country: apt.country,
      lat: apt.lat,
      lng: apt.lng,
    })
    if (placeCount === 0) {
      // Generation produced nothing usable; the lib left any existing guide intact. The
      // cooldown claim above has ALREADY been consumed, so an immediate retry returns 429 —
      // the message must not promise one (the client copy says "in a few hours" to match).
      return res.status(503).json({ error: 'guide_empty', message: 'No recommendations were generated. You can try again in a few hours.' })
    }

    // Regenerate the neighbourhood blurb alongside the guide. Best-effort: a blurb
    // failure must never change the guide's HTTP response.
    try {
      await generateGreetingBlurb(supabase, {
        id: apt.id,
        street: apt.street,
        street_number: apt.street_number,
        neighborhood: apt.neighborhood,
        city: apt.city,
        country: apt.country,
      })
    } catch (e) {
      console.warn('[generate-guide] blurb failed (non-fatal)', scrubErr(e, 120))
    }

    return res.status(200).json({ ok: true, placeCount })
  } catch {
    return res.status(500).json({ error: 'Guide generation failed' })
  }
}
