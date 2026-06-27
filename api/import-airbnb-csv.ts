import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-auth endpoint: a host uploads the Airbnb "Reservations"/transaction CSV (which
// carries guest names the iCal feed does NOT) and we attach the guest's first name to the
// already-synced booking it matches by date. Names then survive every future sync because
// the reconcile RPC never overwrites guest_id. No new tables, no DB migration — writes to
// bookings + guests via the service-role client, exactly like create-booking.ts. Mirrors
// that file's auth/ownership conventions. Never deletes or cancels anything.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CSV_LEN = 1_000_000
const MAX_DATA_ROWS = 5000

// Column indices, VERIFIED against Udy's beautiful_private_space_FIXED.csv (18 cols:
// Date, Type, Confirmation code, Booking date, Start date, End date, Nights, Guest, Listing, …).
// Airbnb localises header TEXT but not column ORDER — these positional indices are the
// language-proof contract. A future format change is a one-line fix here.
const COL_START = 4, COL_END = 5, COL_NIGHTS = 6, COL_GUEST = 7

// Best-effort, per-instance rate limiter (copied from sync-ical.ts) — keyed by the
// authenticated userId, not IP, since this endpoint is Bearer-gated and host-scoped.
const RL_MAX = 5
const RL_WINDOW_MS = 60_000
const rlHits = new Map<string, { count: number; windowStart: number }>()
function rateLimited(key: string, now: number): boolean {
  const entry = rlHits.get(key)
  if (!entry || now - entry.windowStart >= RL_WINDOW_MS) {
    rlHits.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RL_MAX
}

// Quote-aware RFC4180 reader: fields may be wrapped in double quotes and contain commas;
// "" is an escaped quote; handles \r\n and \n. Strips a leading BOM first.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

// MM/DD/YYYY → YYYY-MM-DD, rejecting impossible dates via a UTC round-trip (mirrors
// create-booking's isValidDate). Airbnb's transaction CSV uses US date order.
function parseUsDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null
  return iso
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Import service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  if (rateLimited(userId, Date.now())) return res.status(429).json({ error: 'rate_limited' })

  const body = (req.body ?? {}) as { apartment_id?: unknown; csv?: unknown }
  const apartmentId = typeof body.apartment_id === 'string' ? body.apartment_id : ''
  const csv = typeof body.csv === 'string' ? body.csv : ''

  if (!UUID_RE.test(apartmentId)) return res.status(400).json({ error: 'Invalid input' })
  if (!csv || csv.length > MAX_CSV_LEN) return res.status(400).json({ error: 'Invalid input' })

  // Service-role client only AFTER auth + input validation. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)

  // Ownership: the apartment must belong to the authenticated host. Never trust the
  // client apartment_id for authorization.
  const { data: apt } = await admin
    .from('apartments')
    .select('id')
    .eq('id', apartmentId)
    .eq('host_id', userId)
    .maybeSingle()
  if (!apt) return res.status(403).json({ error: 'Forbidden' })

  const rows = parseCsv(csv)

  let matched = 0   // CSV data rows that found ≥1 confirmed booking
  let named = 0     // bookings actually given/updated a name
  let skipped = 0   // CSV data rows with no match
  let ambiguous = 0 // extra same-date matches beyond the one named
  let dataRows = 0

  for (const row of rows) {
    if (dataRows >= MAX_DATA_ROWS) break

    const start = parseUsDate(row[COL_START] ?? '')
    if (!start) continue

    let end = parseUsDate(row[COL_END] ?? '')
    if (!end) {
      const nightsRaw = (row[COL_NIGHTS] ?? '').trim()
      const nights = /^\d+$/.test(nightsRaw) ? parseInt(nightsRaw, 10) : NaN
      if (Number.isFinite(nights) && nights > 0) end = addDays(start, nights)
    }
    if (!end) continue

    const guestCell = (row[COL_GUEST] ?? '').trim()
    if (!guestCell) continue

    // This is a DATA row (start parses, end resolves, guest non-empty) — never depends on
    // the localised Type cell, so the header + payout/summary rows are skipped by guard.
    dataRows++

    const firstName = guestCell.split(/\s+/)[0]?.trim().slice(0, 80) ?? ''
    if (!firstName) continue

    const { data: candidates } = await admin
      .from('bookings')
      .select('id, guest_id, created_at')
      .eq('apartment_id', apartmentId)
      .eq('source', 'airbnb')
      .eq('status', 'confirmed')
      .eq('check_in', start)
      .eq('check_out', end)
      .order('created_at', { ascending: true })

    if (!candidates || candidates.length === 0) { skipped++; continue }

    matched++
    const target = candidates[0]
    if (candidates.length > 1) ambiguous += candidates.length - 1

    if (target.guest_id) {
      // Idempotent re-upload / correction — update the existing guest, no duplicate row.
      const { error: updErr } = await admin
        .from('guests')
        .update({ first_name: firstName })
        .eq('id', target.guest_id)
      if (updErr) {
        console.error('[import-airbnb-csv] guest update failed —', updErr.message?.slice(0, 120))
        continue
      }
      named++
    } else {
      const { data: newGuest, error: insErr } = await admin
        .from('guests')
        .insert({ first_name: firstName, last_name: '', email: '' })
        .select('id')
        .single()
      if (insErr || !newGuest) {
        console.error('[import-airbnb-csv] guest insert failed —', insErr?.message?.slice(0, 120))
        continue
      }
      const { error: linkErr } = await admin
        .from('bookings')
        .update({ guest_id: newGuest.id })
        .eq('id', target.id)
      if (linkErr) {
        console.error('[import-airbnb-csv] booking link failed —', linkErr.message?.slice(0, 120))
        continue
      }
      named++
    }
  }

  return res.status(200).json({ matched, named, skipped, ambiguous })
}
