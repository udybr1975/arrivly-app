import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'

// Daily cron: data-minimisation PURGE. Auto-DELETES unconverted demo accounts + ALL their
// data 1 day after the demo expired, so nothing belonging to a non-host lingers.
//
// DENY-BY-DEFAULT: a host is selected ONLY when is_demo=true AND demo_expires_at is more
// than 1 day past AND there is no Stripe subscription. `is_demo=true` is the hard guard —
// a CONVERTED host is is_demo=false and can NEVER match (the stripe-null check is
// belt-and-suspenders). The >1-day age preserves the convert-after-expiry recovery window
// (an expired demo within its first day past is left alone).
//
// Deleting the auth user cascades auth.users → public.hosts → apartments → every child
// table (details/qr_secrets/bookings/events/greetings/optins/guides/picks/messages/push).
// THE ONE EXCEPTION: bookings.guest_id → guests is ON DELETE SET NULL and nothing cascades
// into public.guests, so the seeded "Alex" guest rows would orphan — we capture their ids
// BEFORE deletion and delete ONLY those ids (never a blanket orphan-guest sweep). Demos use
// a remote Unsplash city image (no Storage upload), so no Storage cleanup is in scope.
//
// CRON_SECRET-gated (fails closed), service-role only, per-host isolation (one failure
// can't abort the run), idempotent (a leftover host is reconciled next run), batch-capped.
// Logs counts only — never an email or other PII.

const BATCH = 200

function scrub(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 160)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // Fail closed: never proceed without the service-role key.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[cron-demo-purge] missing service role key')
    return res.status(500).json({ error: 'Service not configured' })
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL!, serviceKey)

  // Eligibility (deny-by-default): a demo, expired more than 1 day ago, that never subscribed.
  const cutoffIso = new Date(Date.now() - 86_400_000).toISOString()
  const { data: hosts, error } = await supabase
    .from('hosts')
    .select('id')
    .eq('is_demo', true)
    .not('demo_expires_at', 'is', null)
    .lt('demo_expires_at', cutoffIso)
    .is('stripe_subscription_id', null)
    .order('demo_expires_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('[cron-demo-purge] eligibility query failed —', scrub(error))
    return res.status(500).json({ error: 'Purge failed' })
  }

  let purged = 0
  let failed = 0

  for (const h of (hosts ?? []) as Array<{ id: string }>) {
    const hostId = h.id
    try {
      // 1) Capture the seeded guest ids BEFORE deletion — the booking→guest linkage is lost
      //    once the cascade removes the bookings. Guest rows are 1:1 with bookings
      //    (fresh-per-booking, server-created, NO cross-host dedup — see S24), so deleting
      //    by captured id can only ever touch THIS host's about-to-be-removed bookings. If
      //    cross-host guest dedup is ever reintroduced, host-scope this delete.
      const { data: apts } = await supabase.from('apartments').select('id').eq('host_id', hostId)
      const aptIds = ((apts ?? []) as Array<{ id: string }>).map((a) => a.id)
      let guestIds: string[] = []
      if (aptIds.length > 0) {
        const { data: bks } = await supabase
          .from('bookings')
          .select('guest_id')
          .in('apartment_id', aptIds)
          .not('guest_id', 'is', null)
        guestIds = Array.from(
          new Set(
            ((bks ?? []) as Array<{ guest_id: string | null }>)
              .map((b) => b.guest_id)
              .filter((g): g is string => !!g),
          ),
        )
      }

      // 2) Delete the seeded guest rows FIRST — ONLY the ids captured for THIS host (never a
      //    blanket orphan sweep). bookings.guest_id is ON DELETE SET NULL, so this merely
      //    nulls the soon-to-be-deleted bookings' FK. Doing it BEFORE deleteUser makes the
      //    job self-healing: on any partial failure the host stays eligible and is fully
      //    reconciled next run (no permanently-orphaned guest rows).
      if (guestIds.length > 0) {
        const { error: gErr } = await supabase.from('guests').delete().in('id', guestIds)
        if (gErr) throw new Error(`guests delete — ${gErr.message?.slice(0, 120)}`)
      }

      // 3) Delete the auth user → cascades auth.users → hosts → apartments → all child rows.
      const { error: delErr } = await supabase.auth.admin.deleteUser(hostId)
      if (delErr) throw new Error(`deleteUser — ${delErr.message?.slice(0, 120)}`)

      purged++
    } catch (e) {
      // Per-host isolation: a single failure must not abort the run. The host stays
      // eligible and is retried next run.
      failed++
      console.error('[cron-demo-purge] host purge failed —', scrub(e))
    }
  }

  console.log(`[cron-demo-purge] purged=${purged} failed=${failed}`)
  return res.status(200).json({ purged, failed })
}
