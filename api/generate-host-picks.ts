import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { enrichHostPicks } from './_lib/host-picks.js'
import { sendNtfy } from './_lib/ntfy.js'
import { scrubErr } from './_lib/scrub.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  if (!req.body) return res.status(400).json({ error: 'apartmentId and text required' })
  const { apartmentId, text } = req.body as { apartmentId?: string; text?: string }
  if (!apartmentId) return res.status(400).json({ error: 'apartmentId required' })
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' })
  }

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, host_id, city, neighborhood, country')
    .eq('id', apartmentId)
    .single()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  // SPEND BRAKE. A brake is UNFINISHED until its key is in cron-spend-audit's ROLLING_LIMITS —
  // unlisted endpoints are ignored by BOTH detectors, so the 429 would fire while nothing
  // alarmed. 'generate-host-picks' is registered there at 3x this cap.
  //
  // CALLER-KEYED: the bump follows a PROVEN ownership check on apartments.host_id above, so the
  // named host really is the spender and "block this host" is correct remediation — unlike the
  // victim-keyed guest surfaces.
  //
  // WHY THIS ENDPOINT IS NOT MERELY PARITY — IT SPENDS TWO VENDORS PER REQUEST. Beyond the
  // model call on the SHARED GEMINI_API_KEY project, enrichHostPicks fans out to UP TO 20
  // CONCURRENT geocodeAddress calls (_lib/host-picks.ts, `capped.slice(0, 20)`), each hitting
  // LocationIQ. So one unbraked loop here burns a FLEET-WIDE geocoding pool as well as an AI
  // quota — and LocationIQ backs address save, guide places and host picks everywhere, so
  // exhausting it degrades far more than this endpoint. The brake is placed BEFORE
  // enrichHostPicks precisely so an over-cap request spends NEITHER vendor.
  //
  // 10/hour mirrors api/bulk-import.ts and api/import-listing.ts: a host organising one paste
  // spends one call, and a host genuinely iterating on a list does not need eleven.
  const HOST_PICKS_HOURLY_LIMIT = 10
  const { data: hourCount, error: counterErr } = await supabase.rpc('bump_api_counter', {
    p_host_id: userId,
    p_endpoint: 'generate-host-picks',
  })
  if (counterErr) {
    // FAIL CLOSED. The blocked behaviour here is the free fallback — the host adds their picks
    // by hand, which is what they would have done without this feature at all. Fail-open is
    // indefensible when the fallback costs nothing: it would spend uncapped model AND geocoder
    // budget during exactly the burst that broke the counter.
    console.warn('[generate-host-picks] counter bump failed (fail-closed)', scrubErr(counterErr, 120))
    return res.status(503).json({ error: 'busy' })
  }
  if (typeof hourCount !== 'number') {
    console.warn('[generate-host-picks] counter returned a non-number (fail-closed)')
    return res.status(503).json({ error: 'busy' })
  }
  if (hourCount > HOST_PICKS_HOURLY_LIMIT) {
    // Alert INSIDE the over-cap branch and on STRICT EQUALITY, so it is one-shot: a host held at
    // the cap must not be able to fire an alert per request. (Written the other way round it was
    // unreachable — the 429 returns first.)
    if (hourCount === HOST_PICKS_HOURLY_LIMIT + 1) {
      // AWAITED, not fire-and-forget: an un-awaited fetch in a serverless function can be killed
      // when the response returns, which is exactly when this one is sent.
      await sendNtfy({
        title: 'Bemgu — generate-host-picks hourly cap hit',
        message:
          `Host ${userId} exceeded ${HOST_PICKS_HOURLY_LIMIT}/h on /api/generate-host-picks.\n` +
          `CALLER-KEYED: this host is the spender (ownership proven before the bump), so ` +
          `blocking them is correct remediation.\n` +
          `REVOKE + ROTATE if abuse is confirmed: GEMINI_API_KEY ` +
          `(gen-lang-client-0819525902) AND LOCATIONIQ_API_KEY — both are spent per call.`,
        priority: 'high',
      }).catch(() => {})
    }
    return res.status(429).json({ error: 'rate_limited' })
  }

  try {
    const picks = await enrichHostPicks(text.trim().slice(0, 5000), {
      city: apt.city,
      neighborhood: apt.neighborhood,
      country: apt.country,
    })
    return res.status(200).json({ picks })
  } catch {
    return res.status(500).json({ error: 'Pick generation failed' })
  }
}
