import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { scrubErr } from './_lib/scrub.js'
import { sendNtfy } from './_lib/ntfy.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// The per-hour brakes alarm only at exactly limit+1, once, then the counter resets on the UTC
// hour - so an attacker pacing at/under the hourly limit sustains the full ceiling with no
// alert. This job sums each host's usage over the last WINDOW_HOURS and alarms on sustained
// high utilisation.
//
// HONEST SCOPE - do NOT record the paced-attacker blind spot as closed. Thresholds are ~3x the
// hourly limit = ~50% of the 6h ceiling, so this NARROWS the silent band from 100% to ~49.6%,
// a 2x reduction, not a closure. Two structural gaps remain: there is no CROSS-HOST aggregate
// (and on the guest surfaces the counter key is the VICTIM host's id, so an attacker holding
// tokens across N hosts runs at N x 49.6% invisibly to both layers), and no cross-endpoint view
// (a host at 49% on all seven endpoints at once is invisible).
//
// Thresholds mirror the per-endpoint hourly limits in the api/ files - if you change an hourly
// limit, revisit the matching value here. EXCEPTION: generate-guide has no hourly limit (a 6h
// atomic claim caps real generations at 1/host/6h), so its 30 can never be reached by actual
// spend - it is a LOOP DETECTOR, counting the 429'd attempts that bump the counter before the
// cooldown check. Do not "correct" it to mirror something. Endpoints not listed are ignored.
const WINDOW_HOURS = 6
const ROLLING_LIMITS: Record<string, number> = {
  'guest-chat': 120,
  'daily-greeting': 150,
  'create-booking': 90,
  'sync-ical': 15,
  'generate-guide': 30,
  'city-events-public': 21,
  'city-events-host': 9,
}
const KEY_HINT: Record<string, string> = {
  'guest-chat': 'GEMINI_API_KEY_CHAT = gen-lang-client-0221179352',
  'daily-greeting': 'GEMINI_API_KEY = gen-lang-client-0819525902 (shared key)',
  'city-events-public': 'GEMINI_API_KEY_EVENTS = gen-lang-client-0131909896',
  'city-events-host': 'GEMINI_API_KEY_EVENTS = gen-lang-client-0131909896',
  'generate-guide': 'GEMINI_API_KEY_GUIDES = gen-lang-client-0816353550',
  'create-booking': 'amplifier (mints guest passes) - watch guest-chat + daily-greeting spend',
  'sync-ical': 'amplifier (mints guest passes) - watch guest-chat + daily-greeting spend',
}

// Cap the per-run alert fan-out. Each sendNtfy holds up to a 5s abort timeout, so an uncapped
// sequential loop could burn the whole maxDuration and starve everything after it. Overflow is
// summarised in one extra message so nothing is silently dropped.
const MAX_ALERTS = 20
// Page size for the counter scan. PostgREST enforces a server-side max-rows cap and returns the
// truncated set with NO error and NO signal, so an unpaginated select would silently UNDER-COUNT
// as the fleet grows - i.e. it would miss exactly the abusers this job exists to catch, while
// still reporting ok:true. We therefore page by ACTUAL returned length (never by the requested
// size, which the server may clamp below PAGE) until a page comes back empty.
const PAGE = 1000
const MAX_PAGES = 100

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()

  // Sum per (host, endpoint) across the window. NOTE the window is really 6-7 hourly buckets:
  // sinceIso is a rolling wall-clock offset while window_start is hour-truncated, so the oldest
  // partial bucket is included. That biases toward MORE sensitivity, which is the safe direction.
  const totals = new Map<string, { host: string; endpoint: string; total: number }>()
  let rows = 0
  let truncated = false

  // Deterministic ordering is required for range pagination to be stable across pages.
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true
      console.error('[cron-spend-audit] page cap hit - scan incomplete, totals UNDER-COUNT')
      break
    }
    const { data, error } = await supabase
      .from('api_call_counters')
      .select('host_id, endpoint, count')
      .gte('window_start', sinceIso)
      .order('window_start', { ascending: true })
      .order('host_id', { ascending: true })
      .order('endpoint', { ascending: true })
      .range(rows, rows + PAGE - 1)
    if (error) {
      console.error('[cron-spend-audit] query failed -', scrubErr(error, 160))
      // Loud, not silent: a blind audit alongside the brakes' own fail-open on counter error
      // would otherwise mean brakes off AND detection off with zero signal.
      try {
        await sendNtfy({
          title: 'Bemgu spend audit FAILED',
          message:
            `The rolling spend audit could not read api_call_counters.\n` +
            `Sustained-abuse detection is BLIND until this run succeeds.\n` +
            `ACTION: check Supabase health and the Vercel logs for /api/cron-spend-audit.`,
          priority: 'high',
        })
      } catch { /* alerting is best-effort; never throw out of the cron */ }
      return res.status(200).json({ ok: false })
    }

    const batch = data ?? []
    for (const row of batch) {
      const endpoint = String(row.endpoint)
      // Own-property lookup: `endpoint in ROLLING_LIMITS` would also match inherited
      // Object.prototype keys ('constructor', 'toString'), whose value is a function - the
      // later `total < limit` comparison would then be NaN-false and fire a bogus alert.
      const limit = ROLLING_LIMITS[endpoint]
      if (typeof limit !== 'number') continue
      const host = String(row.host_id)
      const cnt = typeof row.count === 'number' ? row.count : 0
      const k = `${host}|${endpoint}`
      const prev = totals.get(k)
      if (prev) prev.total += cnt
      else totals.set(k, { host, endpoint, total: cnt })
    }

    // Advance by the ACTUAL count, so a server-side clamp below PAGE cannot be mistaken for
    // the end of the table. An empty page is the only end condition.
    rows += batch.length
    if (batch.length === 0) break
  }

  // Housekeeping BEFORE the alert fan-out. The prune is the closure for the api_call_counters
  // retention gap, and running it after an uncapped loop meant it silently stopped happening
  // under exactly the load it matters for. It depends only on the completed scan.
  //
  // The .lt() filter is LOAD-BEARING FOR ENFORCEMENT, not just housekeeping: without it this
  // becomes a full table wipe that resets every host's CURRENT-hour counter and silently
  // disables all six cross-instance brakes on every run.
  // SCOPE OF THE GUARD BELOW, precisely: it validates only the CUTOFF VALUE, so it catches an
  // inverted sign or a too-recent cutoff. It CANNOT detect a dropped .lt() filter - nothing
  // here can. Do not read it as protecting the filter itself.
  let pruned: number | null = null
  try {
    const cutoffMs = Date.now() - 48 * 3600_000
    if (!(cutoffMs < Date.now() - 24 * 3600_000)) {
      console.error('[cron-spend-audit] prune cutoff sanity check FAILED - skipping prune')
    } else {
      const { error: delErr, count } = await supabase
        .from('api_call_counters')
        .delete({ count: 'exact' })
        .lt('window_start', new Date(cutoffMs).toISOString())
      if (delErr) console.warn('[cron-spend-audit] prune failed (non-fatal) -', scrubErr(delErr, 120))
      else pruned = count ?? null
    }
  } catch (e) {
    console.warn('[cron-spend-audit] prune threw (non-fatal)', scrubErr(e, 120))
  }

  const over = [...totals.values()].filter(t => t.total >= ROLLING_LIMITS[t.endpoint])
  // Loudest first, so a capped run reports the worst offenders rather than an arbitrary slice.
  over.sort((a, b) => b.total - a.total)

  // Log the FULL list before alerting. The per-alert and overflow messages both point here, and
  // without this the identities beyond MAX_ALERTS would exist nowhere - making that instruction
  // false. Logged before the fan-out so a maxDuration timeout cannot lose it.
  if (over.length > 0) {
    console.warn('[cron-spend-audit] over threshold:', JSON.stringify(over.map(o => `${o.host}|${o.endpoint}=${o.total}`)))
  }

  let alerts = 0
  for (const { host, endpoint, total } of over.slice(0, MAX_ALERTS)) {
    alerts++
    try {
      await sendNtfy({
        title: 'Bemgu SUSTAINED spend alert (rolling 6h)',
        message:
          `Host ${host}: ${total} ${endpoint} calls in the last ${WINDOW_HOURS}h (rolling threshold ${ROLLING_LIMITS[endpoint]}).\n` +
          `Paced at/under the hourly cap, so the per-hour alarm alone may not have flagged this.\n` +
          `${KEY_HINT[endpoint] ?? 'see the endpoint owner'}\n` +
          `ACTION: block this host in Supabase.`,
        priority: 'high',
      })
    } catch (e) {
      console.warn('[cron-spend-audit] alert failed (non-fatal)', scrubErr(e, 120))
    }
  }

  // An under-counting scan is the same class of failure as a failed one - it reports ok:true
  // while missing exactly the abusers this job exists to catch - so it pages the operator too,
  // rather than sitting in a log nobody reads.
  if (truncated) {
    try {
      await sendNtfy({
        title: 'Bemgu spend audit INCOMPLETE',
        message:
          `The rolling spend audit hit its page cap and did NOT scan the full window.\n` +
          `Totals UNDER-COUNT, so sustained abuse may be missed this run.\n` +
          `ACTION: raise MAX_PAGES or move the sum server-side. Vercel logs: /api/cron-spend-audit.`,
        priority: 'high',
      })
    } catch { /* best-effort */ }
  }

  if (over.length > MAX_ALERTS) {
    try {
      await sendNtfy({
        title: 'Bemgu SUSTAINED spend alert (overflow)',
        message:
          `${over.length - MAX_ALERTS} further host/endpoint pairs are over the rolling threshold ` +
          `and were not alerted individually (cap ${MAX_ALERTS}).\n` +
          `The full list is in the run's console output.\n` +
          `ACTION: read the Vercel logs for /api/cron-spend-audit.`,
        priority: 'high',
      })
    } catch { /* best-effort */ }
  }

  console.log(`[cron-spend-audit] scanned=${totals.size} rows=${rows} over=${over.length} alerts=${alerts} pruned=${pruned ?? 'n/a'}${truncated ? ' TRUNCATED' : ''}`)
  return res.status(200).json({ ok: true, scanned: totals.size, alerts, over: over.length, pruned, truncated })
}
