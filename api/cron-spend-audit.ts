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
// a 2x reduction, not a closure. The CROSS-HOST aggregate gap this block used to list is CLOSED -
// it is implemented below (GLOBAL_HOST_EQUIVALENT + globalByEndpoint), so the Sybil residual is a
// FIXED CONSTANT rather than growing in N. Note the guest surfaces still key on the VICTIM host's
// id, which is why the alerts say investigate before blocking. ONE structural gap remains: no
// cross-endpoint view (a host at 49% on EVERY tracked endpoint at once is invisible - phrased
// without a number on purpose, since that count goes stale the moment an endpoint is registered).
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
  // 3x the 20/hour cap in api/resolve-canonical-city.ts. REGISTERED DELIBERATELY, and it is not
  // optional bookkeeping: that brake exists to protect LocationIQ's 5,000/day pool, which is
  // FLEET-WIDE, and a per-host hourly cap provably cannot bound a fleet pool (the Tavily lesson).
  // Unlisted endpoints are ignored by BOTH detectors below, so without this line ~11 accounts
  // pacing at 20/h would cross the daily pool while every one of them stayed under limit+1 and
  // nothing alarmed. This is also the only counter here whose vendor is NOT an AI provider.
  'resolve-canonical-city': 60,
  // 3x the 10/hour cap in api/import-listing.ts. Registered in the SAME commit that added the
  // brake, because a brake is UNFINISHED until its key is here: unlisted endpoints are ignored
  // by BOTH detectors below, so the 429 would fire while nothing alarmed. CALLER-KEYED — the
  // bump follows a proven apartments.host_id ownership check, so blocking the named host is
  // correct remediation. This endpoint carries the largest per-call Groq reservation of any
  // host-authenticated surface, against an ORG-WIDE minute.
  'import-listing': 30,
  // 3x the 10/hour cap in api/bulk-import.ts. Registered in the SAME commit that added the
  // brake, because a brake is UNFINISHED until its key is here: unlisted endpoints are ignored
  // by BOTH detectors below, so the 429 would fire while nothing alarmed. CALLER-KEYED — the
  // bump follows a proven apartments.host_id ownership check, so blocking the named host is
  // correct remediation. Sibling of 'import-listing' above: same 10/hour cap, same job through
  // an older door, and unlike that one this endpoint may resolve to EITHER provider.
  'bulk-import': 30,
  // 3x the 30/hour cap in api/cancel-booking.ts. Registered for the reason the block above
  // exists: a brake is UNFINISHED until its key is in this allowlist, because unlisted
  // endpoints are ignored by BOTH detectors and the 429 would fire while nothing alarmed.
  // CLASSIFIED CALLER-KEYED — the bump follows a proven ownership check on
  // apartments.host_id, so blocking the named host is the correct remediation. NOTE this
  // file emits ONE SHARED alarm string for every endpoint (it leads with "INVESTIGATE BEFORE
  // BLOCKING" and names the four victim-keyed endpoints as the exception), so the
  // classification does not change the rendered text today — it is recorded here so a future
  // per-endpoint wording pass puts this one on the right side. No KEY_HINT: this endpoint
  // spends nothing with any vendor, so there is no key to revoke; the builders fall back to
  // 'see the endpoint owner'. Registered for the cross-endpoint view.
  'cancel-booking': 90,
  // 3x the 20/hour failed-claim cap in api/welcome-claim.ts. Registered in the SAME commit
  // that added the brake, because a brake is UNFINISHED until its key is here: unlisted
  // endpoints are ignored by BOTH detectors below, so the endpoint's 429 would fire while
  // nothing alarmed — and this endpoint is the one an attacker actually has a reason to
  // attack, since a correct guess yields a guest token.
  // CLASSIFIED VICTIM-KEYED, and it is the strongest case of it in this file: the counter is
  // keyed on the host whose PROPERTY was addressed by a PUBLIC caller, so the named host is
  // the target of the guessing run and never its author. Remediation is INVESTIGATE; it must
  // never be reworded to "block this host". No KEY_HINT — this endpoint spends nothing with
  // any vendor, so there is no key to revoke.
  //
  // BOTH ALERT STRINGS BELOW NAME THIS ENDPOINT EXPLICITLY, and that is not decoration: their
  // victim-keyed list reads as exhaustive, so an endpoint absent from it is placed on the
  // caller-keyed side by omission — pointing an operator at blocking a PAYING HOST who is the
  // one being attacked. A classification comment that the rendered message contradicts is
  // worth nothing. If a victim-keyed endpoint is ever added, add it to both strings too.
  'welcome-claim': 60,
}
const KEY_HINT: Record<string, string> = {
  'guest-chat': 'GEMINI_API_KEY_CHAT = gen-lang-client-0221179352',
  'daily-greeting': 'GEMINI_API_KEY = gen-lang-client-0819525902 (shared key)',
  'city-events-public': 'GEMINI_API_KEY_EVENTS = gen-lang-client-0131909896',
  'city-events-host': 'GEMINI_API_KEY_EVENTS = gen-lang-client-0131909896',
  'generate-guide': 'GEMINI_API_KEY_GUIDES = gen-lang-client-0816353550',
  'create-booking': 'amplifier (mints guest passes) - watch guest-chat + daily-greeting spend',
  'sync-ical': 'amplifier (mints guest passes) - watch guest-chat + daily-greeting spend',
  // Names the blast radius, not just the key: revoking this breaks address lookup EVERYWHERE
  // (address save, guide places, host picks), not only the resolve endpoint. 74 chars - RE-MEASURED
  // 21 Aug 2026 by executing both templates at their worst case (this hint, the longest endpoint
  // name): per-host 467, global 487, both inside sendNtfy's 500-char slice with this hint intact
  // as the last line. The figures moved from 451/472 when welcome-claim was added to the
  // victim-keyed list in each string (+14 chars); re-measure again if either string grows.
  'resolve-canonical-city': 'LOCATIONIQ_API_KEY - shared with forward geocoding (address, guide, picks)',
  // Names the blast radius rather than the surface: GROQ_API_KEY is the ORG-WIDE TPM pool that
  // every Groq surface shares, so an operator paged about this endpoint must know that revoking
  // it stops the greeting, events, host-picks and the guide too. Without this entry the cron's
  // own alert falls back to 'see the endpoint owner' while the endpoint's own alarm names the
  // key — two alerts about one incident disagreeing on the remediation.
  'import-listing': 'GROQ_API_KEY (console.groq.com) - ORG-WIDE TPM, shared by every Groq surface',
  // Names BOTH providers because this surface alone resolves per AI_PROVIDER_BULK_IMPORT: the
  // groq branch spends the ORG-WIDE Groq TPM pool, the gemini branch spends the SHARED
  // GEMINI_API_KEY project (gen-lang-client-0819525902). An operator paged about this endpoint
  // cannot tell which from the alert, so naming one key would point half the incidents at the
  // wrong console. 66 chars - re-measured 27 Aug 2026 by executing both templates with this
  // hint: per-host 448, global 471, both inside sendNtfy's 500-char slice with this hint
  // intact as the last line.
  'bulk-import': 'GROQ_API_KEY or GEMINI_API_KEY (shared) - provider set per surface',
}

// Cross-host aggregate (Sybil detection). Every per-host check below (and every brake) keys on
// ONE host, so an attacker spread across many accounts, each held under its per-host limit, is
// invisible to them. The global check sums EVERY host per endpoint over the same window and
// alarms when an endpoint's fleet-wide total exceeds GLOBAL_HOST_EQUIVALENT worth of the
// per-host rolling threshold - i.e. "this many hosts all sustaining the rolling limit at once",
// implausible at current scale and a clear Sybil signal. RAISE THIS as the real host base grows,
// or it will false-positive once that many hosts are legitimately busy at the same time.
const GLOBAL_HOST_EQUIVALENT = 5

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
  const globalByEndpoint = new Map<string, { total: number; hosts: Set<string> }>()
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

      const g = globalByEndpoint.get(endpoint)
      if (g) { g.total += cnt; g.hosts.add(host) }
      else globalByEndpoint.set(endpoint, { total: cnt, hosts: new Set([host]) })
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
  // disables EVERY COUNTER-GATED brake on every run. Precisely, because the distinction matters
  // when judging blast radius: generate-guide is the one bump site whose counter gates NOTHING
  // (its real cross-instance gate is the atomic 6h hosts.guide_claimed_at claim), so a wipe
  // blinds its loop ALARM but leaves its brake standing. Stated without a count on purpose - the
  // number moves every time an endpoint is registered.
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

  // Cross-host aggregate. Fires independently of the per-host alerts: a Sybil attacker spread
  // under the per-host limit produces NO per-host over-row yet a large fleet-wide total. Only
  // the tracked endpoints (via ROLLING_LIMITS) ever entered globalByEndpoint. There are at most
  // as many entries as tracked endpoints, so no overflow handling is needed here.
  //
  // COMPUTED AND LOGGED BEFORE ANY FAN-OUT, deliberately: the per-host fan-out below can hold
  // up to 22 x 5s of ntfy timeouts, so leaving this after it meant a WIDE run could exhaust
  // maxDuration before the cross-host finding was ever computed - losing both the alert and the
  // only record of the contributors. The pure-Sybil case was safe (no per-host rows to alert
  // on); the mixed case was not.
  const globalOver: Array<{ endpoint: string; total: number; hosts: number; threshold: number }> = []
  for (const [endpoint, g] of globalByEndpoint) {
    const rolling = ROLLING_LIMITS[endpoint]
    if (typeof rolling !== 'number') continue
    const threshold = GLOBAL_HOST_EQUIVALENT * rolling
    if (g.total >= threshold) globalOver.push({ endpoint, total: g.total, hosts: g.hosts.size, threshold })
  }
  globalOver.sort((a, b) => b.total - a.total)

  // Fleet total for EVERY tracked endpoint, over threshold or not. This is the calibration
  // baseline: without it the first evidence that GLOBAL_HOST_EQUIVALENT is too low arrives as a
  // FALSE POSITIVE, which trains a reactive raise - the wrong direction for a detector.
  console.log('[cron-spend-audit] fleet totals:', JSON.stringify(
    [...globalByEndpoint.entries()].map(([e, g]) => `${e}=${g.total}/${GLOBAL_HOST_EQUIVALENT * (ROLLING_LIMITS[e] ?? 0)} (${g.hosts.size} hosts)`)
  ))

  // For each globally-over endpoint, log its top per-host contributors. In the Sybil case NONE
  // of them appears in the per-host `over` list, so this is the ONLY place their identities are
  // recorded - the alert points here.
  for (const { endpoint } of globalOver) {
    const contributors = [...totals.values()]
      .filter(t => t.endpoint === endpoint)
      .sort((a, b) => b.total - a.total)
      .slice(0, 30)
      .map(t => `${t.host}=${t.total}`)
    console.warn(`[cron-spend-audit] GLOBAL ${endpoint} top contributors:`, JSON.stringify(contributors))
  }

  // GLOBAL fan-out runs BEFORE the per-host one: order a fan-out by severity and boundedness,
  // not by computation order. This is the higher-signal finding and is structurally bounded to
  // ONE MESSAGE PER TRACKED ENDPOINT (a count, deliberately not written as a literal, since it
  // moves with ROLLING_LIMITS), while the per-host loop can hold up to 22 x 5s of timeouts and
  // would otherwise be able to exhaust maxDuration before the cross-host alert ever sent.
  for (const { endpoint, total, hosts, threshold } of globalOver) {
    try {
      await sendNtfy({
        title: 'Bemgu GLOBAL spend alert (cross-host, rolling 6h)',
        // Kept under sendNtfy's 500-char body slice, with ACTION second so truncation can never
        // eat the actionable part. The victim-vs-caller warning is load-bearing, not padding.
        message:
          `Endpoint ${endpoint}: ${total} calls across ${hosts} hosts in ${WINDOW_HOURS}h (threshold ${threshold}).\n` +
          `ACTION: see GLOBAL top-contributors in the Vercel logs, then INVESTIGATE BEFORE BLOCKING.\n` +
          `Contributors are counter KEYS: on guest-chat/daily-greeting/city-events-public/welcome-claim the key is the VICTIM host, not the caller - rotate QR secrets / revoke tokens instead.\n` +
          `A Sybil spread under the per-host limits shows here only.\n` +
          `${KEY_HINT[endpoint] ?? 'see the endpoint owner'}`,
        priority: 'high',
      })
    } catch (e) {
      console.warn('[cron-spend-audit] global alert failed (non-fatal)', scrubErr(e, 120))
    }
  }

  let alerts = 0
  for (const { host, endpoint, total } of over.slice(0, MAX_ALERTS)) {
    alerts++
    try {
      await sendNtfy({
        title: 'Bemgu SUSTAINED spend alert (rolling 6h)',
        message:
          `Host ${host}: ${total} ${endpoint} calls in the last ${WINDOW_HOURS}h (rolling threshold ${ROLLING_LIMITS[endpoint]}).\n` +
          `ACTION: INVESTIGATE BEFORE BLOCKING - on guest-chat/daily-greeting/city-events-public/welcome-claim this key is the VICTIM host, not the caller (rotate QR secrets / revoke tokens instead).\n` +
          `Paced at/under the hourly cap, so the per-hour alarm alone may not have flagged this.\n` +
          `${KEY_HINT[endpoint] ?? 'see the endpoint owner'}`,
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

  console.log(`[cron-spend-audit] scanned=${totals.size} rows=${rows} over=${over.length} globalOver=${globalOver.length} alerts=${alerts} pruned=${pruned ?? 'n/a'}${truncated ? ' TRUNCATED' : ''}`)
  return res.status(200).json({ ok: true, scanned: totals.size, alerts, over: over.length, globalOver: globalOver.length, pruned, truncated })
}
