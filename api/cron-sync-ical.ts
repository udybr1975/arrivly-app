import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { sendPushToHost } from './_lib/push.js'
import { syncApartmentBookings, type SyncResult } from './_lib/ical.js'
import { mapPool } from './_lib/pool.js'
import { sendNtfy } from './_lib/ntfy.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AptRow {
  id: string
  host_id: string
  name: string | null
  ical_urls: string | null
  ical_last_synced_at: string | null
}

// One apartment's outcome. `deferred` is an EXPLICIT field rather than something inferred
// from the error text: ical.ts's "ran out of time" string is HOST-FACING copy that the
// Step 7 alarm-text sweep is going to rewrite, and a detector that string-matches it would
// break silently when that happens.
type Outcome =
  | { apt: AptRow; deferred: true; result: null }
  | { apt: AptRow; deferred: false; result: SyncResult }

// Shared fetch budget for the whole run, as an ABSOLUTE deadline handed to EVERY
// apartment — so the run is bounded no matter how the pool interleaves. A per-item
// duration could not express this: four items share one wall clock.
//
// THE ARITHMETIC (150s maxDuration). The deadline bounds when a fetch STARTS, not when it
// finishes, so a fetch begun 1ms before it still runs safeFetchIcal's full 10s cap. The
// up-to-4 workers overrun CONCURRENTLY, so that is +10s of wall clock, not +40s. The
// overrun is inside the budget, not on top of it:
//   - in-flight fetches overrunning the deadline (4 in parallel)                 => 10s
//   - those same up-to-4 apartments then finish their reconcile RPCs
//     (<=8 sources x ~2s, sequential per apartment, 4 concurrent)                => 16s
//   - the sequential per-host push loop                                          => 20s
//   - aggregation, JSON response, platform overhead                              =>  4s
// 150 - 50 = 100s. Apartments still QUEUED when the deadline passes cost almost nothing:
// every URL is unread, so every source is incomplete and no RPC is called at all.
const RUN_FETCH_BUDGET_MS = 100_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now()

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  // LEAST-RECENTLY-SYNCED FIRST, never-synced (NULL) leading. This is what stops b1's
  // deadline from creating a permanently starved TAIL: b1 made the truncation ORDERLY and
  // REPEATABLE, which is exactly what makes a stable order harmful — over whatever order
  // Postgres happens to return, the same apartments sit past the deadline every single
  // night, deterministically, and never sync again. Ordering by attempt age makes deferral
  // ROTATE: tonight's deferred apartment leads tomorrow's queue.
  //
  // This is d254df9's recorded reason for LRU ordering, and it also closes the residual that
  // commit could NOT close for its own cron — there, `generated_at` advanced only on a
  // successful write, so a consistently failing unit pinned the queue head forever. The fix
  // both times is a column that every ATTEMPT stamps (see the stamp below), which
  // ical_last_synced_at now provides here.
  const { data, error } = await supabase
    .from('apartments')
    .select('id, host_id, name, ical_urls, ical_last_synced_at')
    .not('ical_urls', 'is', null)
    .neq('ical_urls', '')
    .order('ical_last_synced_at', { ascending: true, nullsFirst: true })
  if (error) return res.status(500).json({ error: 'Query failed' })

  const apartments = (data ?? []) as AptRow[]

  // Parallelise the per-apartment sync with a bounded pool (4 in flight). Each iCal fetch
  // is network-bound and already capped at 10s by safeFetchIcal, so up to 4 concurrent
  // shortens a many-apartment run without raising any per-fetch timeout — but concurrency
  // alone does NOT bound the run against the 150s maxDuration (vercel.json), because ONE
  // apartment can cost up to 20 URLs x 10s = 200s on its own. The shared deadline below is
  // what actually bounds it. Each task RETURNS its result; aggregation happens in a single
  // sequential pass below, so the shared Map/array are never mutated concurrently and the
  // totals/byHost output are identical to the sequential loop.
  const deadlineAt = startedAt + RUN_FETCH_BUDGET_MS
  const synced = await mapPool(apartments, 4, async (apt): Promise<Outcome> => {
    // DEFERRAL GUARD, reusing b1's deadlineAt — deliberately NOT a second constant. d254df9
    // needed its own START_DEADLINE_MS because its items cost ~75s, so starting one late meant
    // starting work that could not finish. Here b1's in-loop deadline already stops the work:
    // an apartment starting 1ms early reads exactly ONE feed and abandons nineteen. deadlineAt
    // IS the right line, and a second constant would be a second thing to keep in step with
    // b1's reserve arithmetic.
    //
    // This does not change what the run COSTS — b1 already made a past-deadline apartment
    // nearly free (every URL unread, every source incomplete, no reconcile RPC). It makes the
    // outcome LEGIBLE: without it a deferral is indistinguishable from a failure, and the
    // alarm below depends on telling them apart.
    if (Date.now() >= deadlineAt) {
      console.warn('[cron-sync-ical] deferred, run deadline reached', { aptId: apt.id })
      return { apt, deferred: true, result: null }
    }

    // STAMP THE ATTEMPT. Ordering is load-bearing in BOTH directions, same rule as d254df9:
    //   - AFTER the deferral check, because a deferred apartment was never attempted; stamping
    //     it would push it down the queue for work it did not do — the exact starvation the
    //     ordering above exists to prevent.
    //   - BEFORE the sync, because a run killed mid-flight must still count as an attempt.
    //     Otherwise a consistently slow or failing apartment pins the head of the queue forever.
    // Stamped on ATTEMPT, never on success: an apartment whose feeds always fail must still
    // rotate. The column is server-write-only (trigger trg_protect_ical_sync silently reverts a
    // write from any other role); this cron holds the service-role key, so its write lands.
    //
    // A failed stamp is NON-FATAL — log and sync anyway. Losing a timestamp costs fairness on
    // the next run; aborting the sync costs the host their bookings.
    const { error: stampErr } = await supabase
      .from('apartments')
      .update({ ical_last_synced_at: new Date().toISOString() })
      .eq('id', apt.id)
    if (stampErr) {
      console.warn(
        '[cron-sync-ical] attempt stamp failed, syncing anyway —',
        stampErr.message?.slice(0, 120)
      )
    }

    return {
      apt,
      deferred: false,
      result: await syncApartmentBookings(supabase, { id: apt.id, ical_urls: apt.ical_urls }, { deadlineAt }),
    }
  })

  const byHost = new Map<string, { count: number; names: Set<string> }>()
  let totalImported = 0
  const errors: string[] = []

  // Single pass: outcome counts AND the existing byHost aggregation.
  //
  // FAILURE IS KEYED ON A NON-EMPTY errors ARRAY — at least one feed this apartment TRIED
  // could not be read — and NOT on imported === 0. This is where sync differs from the events
  // cron, and getting it wrong would re-create a known defect: for events, refreshed === 0 is
  // suspicious, but here ZERO NEW BOOKINGS IS THE NORMAL HEALTHY OUTCOME on most nights, so
  // keying on imported would fire a total-failure alarm nearly every run.
  let deferred = 0
  let failed = 0
  let ok = 0

  for (const entry of synced) {
    // A hole — mapPool's safety net swallowed a thrown mapper and left the slot empty —
    // counts as a FAILURE, not a crash. The mapper here is total, so this is unreachable
    // today; but destructuring `undefined` would throw past the alarm and 500 the run, which
    // is one more way to lose the signal this change exists to add.
    if (!entry) { failed++; continue }
    if (entry.deferred) { deferred++; continue }

    const { apt, result } = entry
    if (!result) { failed++; continue }

    if (result.errors.length) {
      failed++
      errors.push(...result.errors.map((e) => `${apt.name ?? apt.id}: ${e}`))
    } else {
      ok++
    }

    if (result.imported > 0) {
      totalImported += result.imported
      const hostEntry = byHost.get(apt.host_id) ?? { count: 0, names: new Set<string>() }
      hostEntry.count += result.imported
      if (apt.name) hostEntry.names.add(apt.name)
      byHost.set(apt.host_id, hostEntry)
    }
  }

  let pushed = 0
  for (const [hostId, info] of byHost) {
    const names = [...info.names]
    const scope =
      names.length === 1 ? ` for ${names[0]}` : names.length > 1 ? ` across ${names.length} properties` : ''
    const body =
      info.count === 1 ? `1 new booking synced${scope}.` : `${info.count} new bookings synced${scope}.`
    const summary = await sendPushToHost(supabase, hostId, {
      title: info.count === 1 ? 'New booking' : 'New bookings',
      body,
      url: '/dashboard/bookings',
    })
    if (summary.sent > 0) pushed++
  }

  // WHOLESALE-FAILURE ALARM. This cron had NONE until now: before b1 a run that blew the
  // budget was simply killed mid-flight — no JSON summary, no alert — and after b1 it
  // truncates cleanly but still says nothing to anyone.
  //
  // `attempted >= 2`, NOT `attempted > 0` — a DELIBERATE DEPARTURE from d254df9. At
  // attempted === 1, "every attempted apartment failed" means ONE host's calendar link is
  // broken. That is host-actionable, already surfaced in their own dashboard, and
  // indistinguishable from a fleet outage on a single data point. B3.2 recorded exactly this
  // cost on the events cron: candidates is frequently 1 at current fleet size, so one bad unit
  // fired a high-priority total-failure alert and taught the operator to ignore the channel. A
  // FLEET-LEVEL CLAIM NEEDS MORE THAN ONE DATA POINT. Below 2, the signal is the JSON summary
  // and errors[], not ntfy. Do not "fix" this back to > 0.
  //
  // DEFERRAL ENTERS AS `attempted`, NOT as `deferred === 0` — carried across from d254df9,
  // because the obvious form is wrong in the DANGEROUS direction. A skip is ORTHOGONAL to
  // failure; a deferral is CORRELATED with it:
  //   - FAST failure (every feed 404s) returns in milliseconds, nothing defers, and the alarm
  //     fires either way. Fine.
  //   - SLOW failure (hanging feeds burning the whole budget on the first apartments) pushes
  //     every remaining apartment past the deadline — and `deferred === 0` would make PRECISELY
  //     that case silent, which is the expensive mode this alarm exists to catch.
  // Suppressing a detector on a bucket correlated with the fault is not the same as suppressing
  // on an orthogonal one. So the claim is scoped to what was actually tried.
  //
  // The message reports the real denominator, so the claim is true by construction. NO ACTION
  // line, per the fa8fa32 rule: an alarm that names no remediation cannot misdirect one — and
  // a fleet-wide iCal failure could be provider-side, network-side or ours. ASCII-only (emoji
  // cause ByteString errors on Vercel) and far inside sendNtfy's 500-char slice. Wrapped:
  // a failing alarm must never fail the run.
  const attempted = apartments.length - deferred
  if (attempted >= 2 && ok === 0 && failed === attempted) {
    try {
      await sendNtfy({
        title: 'Bemgu iCal sync',
        message: `All ${attempted} attempted calendar syncs failed tonight (${deferred} deferred, ${apartments.length} selected).`,
        priority: 'high',
      })
    } catch (e) {
      console.warn(
        '[cron-sync-ical] alarm failed (non-fatal) —',
        (e instanceof Error ? e.message : 'unknown').slice(0, 120)
      )
    }
  }

  // `apartments` keeps its meaning of "rows selected" and is NOT redefined against the new
  // denominator; deferred/ok/failed are added alongside it (deferred + ok + failed === it).
  return res.status(200).json({
    ok: true,
    apartments: apartments.length,
    imported: totalImported,
    hostsNotified: byHost.size,
    pushed,
    deferred,
    // Exposed as `succeeded`, not `ok`: the response already carries a boolean `ok` field,
    // and a count under the same name would be read as that flag.
    succeeded: ok,
    failed,
    errors,
  })
}
