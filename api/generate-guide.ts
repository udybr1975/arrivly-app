import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { generateGuideForApartment } from './_lib/guide.js'
import { generateGreetingBlurb } from './_lib/greeting.js'

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

  if (!req.body) return res.status(400).json({ error: 'apartment_id required' })
  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('id, host_id, street, street_number, neighborhood, city, country')
    .eq('id', apartment_id)
    .maybeSingle()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  try {
    const { placeCount } = await generateGuideForApartment(supabase, {
      id: apt.id,
      street: apt.street,
      street_number: apt.street_number,
      neighborhood: apt.neighborhood,
      city: apt.city,
      country: apt.country,
    })
    if (placeCount === 0) {
      // Generation produced nothing usable; the lib left any existing guide intact. 503 +
      // guide_empty so the client shows a clear "try again" (a manual retry reliably works).
      return res.status(503).json({ error: 'guide_empty', message: 'No recommendations were generated. Please try again.' })
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
      console.warn('[generate-guide] blurb failed (non-fatal)',
        (e instanceof Error ? e.message : String(e)).slice(0, 120))
    }

    return res.status(200).json({ ok: true, placeCount })
  } catch {
    return res.status(500).json({ error: 'Guide generation failed' })
  }
}
