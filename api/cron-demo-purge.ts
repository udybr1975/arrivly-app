import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { scrubErr } from './_lib/scrub.js'
import { sendNtfy } from './_lib/ntfy.js'

const scrub = (e: unknown): string => scrubErr(e)

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

  // Eligibility (deny-by-default): a demo, expired more than 1 day ago, that never subscribed,
  // and NOT a test account. This cron deletes the auth user and cascades hosts -> apartments ->
  // bookings -> picks — the one destructive host iteration in vercel.json's crons[] — so it is
  // the one place the is_test filter protects data rather than just suppressing work.
  // SCOPE, stated honestly: the is_demo + expired + never-subscribed predicates already made this
  // narrow, and NO host is currently both is_demo and is_test (measured 0, 23 Aug 2026). The
  // filter guards a future fixture built on an expired unconverted demo; it is not fixing a live
  // hazard. TRADE-OFF: a demo flagged is_test is now never purged, so its auth.users row persists
  // indefinitely. Guest identities are still swept globally by cron-retention at 30 days, which
  // takes NO is_test exemption and must never take one.
  const cutoffIso = new Date(Date.now() - 86_400_000).toISOString()
  const { data: hosts, error } = await supabase
    .from('hosts')
    .select('id')
    .eq('is_demo', true)
    .eq('is_test', false)
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

  // --- DEMO-OPEN SUMMARY (launch monitoring, not part of the purge) -----------------------
  //
  // WHY IT LIVES HERE: this is the only DAILY cron that is already about the demo, so the
  // number arrives beside the thing it describes and no new cron, schedule or endpoint was
  // invented for it. It is deliberately the LAST thing the handler does — every line of purge
  // work above has already run and `purged`/`failed` are final, so nothing here can delay,
  // abort or alter the deletion this cron actually exists for. That ordering is the guarantee,
  // not the try/catch alone.
  //
  // TELEMETRY, NOT ALARM (PG-10). A demo-open count can never be urgent — there is no action
  // an operator takes at 07:00 because the number is 47 rather than 39. Putting an
  // informational daily line on the ALARM topic would add volume to the channel whose whole
  // value is that a priority-high spend brake is never dropped. The channel split exists for
  // exactly this distinction; this is the first non-guest-page user of it.
  //
  // THE QUIET-DAY RULE HOLDS, matching every other cron in this project: zero demo activity
  // sends nothing. The condition is on today+yesterday, not today alone, so a run at 07:00 UTC
  // — which is 09:00 or 10:00 Helsinki, when "today so far" is legitimately small — still
  // reports yesterday's complete total rather than going silent on the morning after a busy day.
  //
  // ONE COUPLING THIS ORDERING DOES NOT ESCAPE, stated so silence is not misread: an
  // eligibility-query failure returns 500 far above, so on that day the summary never runs.
  // Since a quiet day is ALSO silent, "no ping" is ambiguous between zero opens and an early
  // purge error. No data is lost either way — the table holds it — but check the cron's own
  // logs before reading silence as zero.
  //
  // THE TABLE IS THE DURABLE ARTEFACT AND THIS PING IS CONVENIENCE. demo_open_counts holds one
  // integer per Helsinki day and is readable by SQL at any time, so a ping that fails, is rate
  // limited, or is never sent because the channel is unset costs a NOTIFICATION, never DATA.
  // That is what makes the fail-silent handling below correct rather than lossy.
  try {
    // Pure date-only arithmetic: `today` is the Helsinki calendar date (same one-liner the rest
    // of the codebase uses), and parsing a YYYY-MM-DD string yields UTC midnight, so subtracting
    // one day and re-slicing is exact. This is NOT the local-Date/toISOString trap — nothing
    // here is constructed from local y/m/d parts.
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' }).split(' ')[0]
    const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)

    const { data: counts, error: cErr } = await supabase
      .from('demo_open_counts')
      .select('day, opens')
      .in('day', [today, yesterday])
    if (cErr) throw new Error(cErr.message?.slice(0, 120))

    const rows = (counts ?? []) as Array<{ day: string; opens: number }>
    // A MISSING ROW IS ZERO, not an error: the table only gains a row on the first open of a
    // day, so "no row" is the normal shape of a quiet day.
    const openCount = (d: string) => rows.find((r) => r.day === d)?.opens ?? 0
    const todayOpens = openCount(today)
    const yesterdayOpens = openCount(yesterday)

    if (todayOpens + yesterdayOpens > 0) {
      await sendNtfy({
        title: 'Bemgu: demo opens',
        message: `Today so far: ${todayOpens} — yesterday: ${yesterdayOpens}`,
        priority: 'default',
        channel: 'telemetry',
      })
    }
  } catch (e) {
    // NO EXCEPTION HERE CAN CHANGE THE RESPONSE — the precise claim, not the broader one. The
    // purge result is already computed and logged above; this is the last statement before the
    // return for that reason. The one path this ordering does NOT cover is DURATION: a stalled
    // read could in principle push the handler past maxDuration and turn a 200 into a 504. Even
    // then the deletions are already committed, counted and logged, and the cron is idempotent —
    // so the summary can affect the STATUS CODE, never the purge OUTCOME.
    console.warn('[cron-demo-purge] demo-open summary failed —', scrub(e))
  }

  return res.status(200).json({ purged, failed })
}
