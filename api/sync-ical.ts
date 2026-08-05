import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendPushToHost } from './_lib/push.js'
import { syncApartmentBookings } from './_lib/ical.js'
import { sendNtfy } from './_lib/ntfy.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Best-effort, per-instance rate limiter (mirrors public-pricing.ts) — keyed by the
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

const SYNC_HOURLY_LIMIT = 5

// Shared abuse alert for the two iCal-flood signals (hourly-limit trip, or a single sync
// hitting the per-sync event cap). Best-effort; never throws. ASCII-only; env var NAMES
// only, never a key value.
async function fireSyncAbuseAlert(userId: string, reason: string): Promise<void> {
  try {
    await sendNtfy({
      title: 'Bemgu abuse alert: iCal sync flood',
      message:
        `Feature: iCal calendar sync (/api/sync-ical)\n` +
        `Host ${userId}: ${reason}.\n` +
        `This is an AMPLIFIER: each calendar event mints a guest pass that unlocks the paid AI.\n` +
        `Watch/curb spend on: guest-chat (GEMINI_API_KEY_CHAT) and daily-greeting (GEMINI_API_KEY).\n` +
        `ACTION: block this host in Supabase. This endpoint itself spends nothing. Vercel logs: /api/sync-ical`,
      priority: 'high',
    })
  } catch (e) {
    console.warn('[sync-ical] abuse alarm failed (non-fatal)', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
  }
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

  if (rateLimited(userId, Date.now())) return res.status(429).json({ error: 'rate_limited' })

  if (!req.body) return res.status(400).json({ error: 'Request body required' })

  const { apartment_id } = req.body as { apartment_id?: string }
  if (!apartment_id) return res.status(400).json({ error: 'apartment_id required' })

  const { data: apt, error: aptErr } = await supabase
    .from('apartments')
    .select('ical_urls, host_id, name')
    .eq('id', apartment_id)
    .single()

  if (aptErr || !apt) return res.status(404).json({ error: 'Apartment not found' })
  if (apt.host_id !== userId) return res.status(403).json({ error: 'Forbidden' })

  // Cross-instance hourly brake. The per-instance 5/min limiter above is best-effort only
  // (Vercel spreads load across lambdas); this atomic counter is the real cross-instance
  // cap on syncs per host per hour. Fail-open on an infra error so a counter outage never
  // blocks a legitimate calendar sync.
  {
    const { data: syncCount, error: counterErr } = await supabase.rpc('bump_api_counter', {
      p_host_id: userId,
      p_endpoint: 'sync-ical',
    })
    if (counterErr) {
      console.error('[sync-ical] counter bump failed (fail-open) -', counterErr.message?.slice(0, 120))
    } else if (typeof syncCount === 'number' && syncCount > SYNC_HOURLY_LIMIT) {
      if (syncCount === SYNC_HOURLY_LIMIT + 1) {
        await fireSyncAbuseAlert(userId, `rate limit tripped (over ${SYNC_HOURLY_LIMIT} syncs/hour)`)
      }
      return res.status(429).json({ error: 'rate_limited' })
    }
  }

  const { imported, skipped, errors, capped } = await syncApartmentBookings(supabase, {
    id: apartment_id,
    ical_urls: apt.ical_urls,
  })

  if (capped) {
    await fireSyncAbuseAlert(userId, 'a single sync exceeded the per-sync calendar-event cap')
  }

  if (imported > 0) {
    try {
      await sendPushToHost(supabase, apt.host_id, {
        title: imported === 1 ? 'New booking' : 'New bookings',
        body: `${imported} new booking${imported === 1 ? '' : 's'} synced for ${apt.name ?? 'your property'}`,
        url: '/dashboard/bookings',
      })
    } catch {
      // ignore — notification is best-effort
    }
  }

  return res.status(200).json({ imported, skipped, errors })
}
