import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendNtfy } from './_lib/ntfy.js'

// Daily cron (05:00 UTC). Data-retention cleanup: HARD-DELETES guest/host messages
// whose linked booking checked out more than RETENTION_DAYS ago. The retention
// anchor is the BOOKING checkout date (booking.check_out), NOT the message age —
// intent is to remove conversations from stays that ended 90+ days ago, so an
// in-progress or recent stay's thread is never touched.
//
// This is a hard delete (data minimisation) — rows are removed, not flagged.
// Implemented as a single SET-BASED delete via the SECURITY DEFINER function
// public.cleanup_old_messages(retention_days int) (join messages→bookings on
// check_out), so the work is one server-side statement, not a per-row loop.
// NOTE: messages.booking_id is NOT-NULL with a non-cascading FK to bookings, so
// every message links to a live booking and orphan messages cannot exist under
// the current schema — no orphan-handling path is needed.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const RETENTION_DAYS = 90

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase.rpc('cleanup_old_messages', { retention_days: RETENTION_DAYS })
  if (error) {
    console.error('[cron-cleanup-messages] rpc failed —', error.message?.slice(0, 120))
    return res.status(500).json({ error: 'Cleanup failed' })
  }

  const deleted = typeof data === 'number' ? data : 0

  // Notify only on a non-zero sweep — a quiet day must not generate daily noise.
  // A notify failure must never fail the handler (sendNtfy never throws).
  if (deleted > 0) {
    await sendNtfy({
      title: 'Bemgu message cleanup',
      message: `Deleted ${deleted} messages past ${RETENTION_DAYS}-day retention.`,
      priority: 'default',
    })
  }

  return res.status(200).json({ ok: true, deleted })
}
