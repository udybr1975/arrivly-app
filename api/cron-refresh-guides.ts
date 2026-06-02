import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { generateGuideForApartment } from './_lib/guide.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow {
  id: string
  name: string | null
  street: string | null
  street_number: string | null
  neighborhood: string | null
  city: string | null
  country: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase
    .from('apartments')
    .select('id, name, street, street_number, neighborhood, city, country')
    .eq('is_visible', true)
    .not('city', 'is', null)
    .neq('city', '')
  if (error) return res.status(500).json({ error: 'Query failed' })

  const apartments = (data ?? []) as AptRow[]
  let refreshed = 0
  const errors: string[] = []

  // Scale note: sequential Gemini + geocode per apartment can exceed the 30s
  // maxDuration at many apartments. Batching is a Phase G follow-up.
  for (const apt of apartments) {
    try {
      await generateGuideForApartment(supabase, {
        id: apt.id,
        street: apt.street,
        street_number: apt.street_number,
        neighborhood: apt.neighborhood,
        city: apt.city,
        country: apt.country,
      })
      refreshed++
    } catch {
      errors.push(`${apt.name ?? apt.id}: failed`)
    }
  }

  return res.status(200).json({ ok: true, apartments: apartments.length, refreshed, errors })
}
