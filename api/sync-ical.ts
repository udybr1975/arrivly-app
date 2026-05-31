import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function detectSource(url: string): string {
  if (/airbnb/i.test(url)) return 'airbnb'
  if (/vrbo|homeaway/i.test(url)) return 'vrbo'
  if (/booking\.com/i.test(url)) return 'booking'
  if (/tripadvisor/i.test(url)) return 'tripadvisor'
  if (/guesty/i.test(url)) return 'guesty'
  if (/hostaway/i.test(url)) return 'hostaway'
  if (/lodgify/i.test(url)) return 'lodgify'
  return 'ical'
}

function parseIcal(text: string): Array<{
  uid: string
  start: string
  end: string
  summary: string
}> {
  const events: Array<{ uid: string; start: string; end: string; summary: string }> = []
  const blocks = text.split('BEGIN:VEVENT')
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]
    const uid = (block.match(/^UID:(.+)$/m)?.[1] ?? '').trim()
    const rawStart = (block.match(/^DTSTART[^:]*:(.+)$/m)?.[1] ?? '').trim()
    const rawEnd = (block.match(/^DTEND[^:]*:(.+)$/m)?.[1] ?? '').trim()
    const summary = (block.match(/^SUMMARY:(.+)$/m)?.[1] ?? '').trim()
    if (!uid || !rawStart || !rawEnd) continue
    const toDate = (s: string) =>
      s.replace(/T.*/, '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
    events.push({ uid, start: toDate(rawStart), end: toDate(rawEnd), summary })
  }
  return events
}

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

  if (!req.body) return res.status(400).json({ error: 'Request body required' })

  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('ical_urls, host_id')
    .eq('id', apartment_id)
    .single()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })

  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  const urls = (apt.ical_urls ?? '')
    .split('\n')
    .map((u: string) => u.trim())
    .filter((u: string) => u.startsWith('http'))

  if (urls.length === 0) return res.status(400).json({ error: 'No iCal URLs configured' })

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const url of urls) {
    const source = detectSource(url)
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Arrivly/1.0 iCal Sync' },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        errors.push(`${source}: HTTP ${response.status}`)
        continue
      }
      const text = await response.text()
      const events = parseIcal(text)

      for (const event of events) {
        const isBlock = /blocked|not available|unavailable|closed/i.test(event.summary)

        const { data: existing } = await supabase
          .from('bookings')
          .select('id')
          .eq('reference_number', event.uid)
          .eq('apartment_id', apartment_id)
          .maybeSingle()

        if (existing) { skipped++; continue }

        await supabase.from('bookings').insert({
          apartment_id,
          guest_id: null,
          check_in: event.start,
          check_out: event.end,
          status: 'confirmed',
          reference_number: event.uid,
          source: isBlock ? `${source}_block` : source,
        })
        imported++
      }
    } catch {
      errors.push(`${source}: fetch failed`)
    }
  }

  return res.status(200).json({ imported, skipped, errors })
}
