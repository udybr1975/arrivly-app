// TWO TOPICS, NEVER ONE, AND NEVER A FALLBACK BETWEEN THEM (PG-10, the MECHANISM).
//
// `channel: 'alarm'` (the DEFAULT, so every existing caller is unchanged) posts to NTFY_URL.
// `channel: 'telemetry'` posts to NTFY_TELEMETRY_URL and nowhere else.
//
// WHY THE SPLIT IS THE MECHANISM AND `5664d43` WAS ONLY THE DETECTOR: the design of each brake
// — one-shot at exactly limit+1, or per-host bounded (api/sync-ical.ts fires per capped sync,
// bounded only by the 5/hour sync limit) — bounds each BRAKE, but it does NOT bound VOLUME on a
// shared topic, because the highest-volume writers are not brakes at all. api/guest-state.ts
// pings on EVERY guest-page open including reloads, and api/welcome-claim.ts's heartbeat is the
// same shape; neither is one-shot or rate-limited. On one topic, a caller reloading a public
// endpoint could push ntfy.sh into its own rate limit, under which a genuine priority-high
// brake alarm from a DIFFERENT endpoint is DROPPED. `5664d43` made that drop visible in the
// logs; this split stops per-request volume reaching the alarm topic at all.
//
// **NEVER ADD A FALLBACK IN EITHER DIRECTION.** Defaulting telemetry to NTFY_URL when
// NTFY_TELEMETRY_URL is unset would silently rebuild the exact coupling this exists to remove,
// and it would do it at the moment the operator is least likely to notice — a fresh deploy
// where the new variable has not been set yet.
//
// THE FAIL DIRECTION IS DELIBERATE AND ASYMMETRIC: an unset telemetry URL means scan pings are
// LOST, which costs launch-monitoring data. An unset or misconfigured alarm URL means alarms
// are lost, which costs the operator their only spend-abuse signal. Losing a scan ping is
// acceptable; a maskable alarm is not. That is why telemetry silently skips and never borrows
// the alarm topic to stay alive.
//
// OPERATIONAL NOTE: until NTFY_TELEMETRY_URL is set in Vercel, telemetry pings skip BY DESIGN
// and alarms are entirely unaffected.
export async function sendNtfy({
  title,
  message,
  priority,
  channel = 'alarm',
}: {
  title: string
  message: string
  priority: 'default' | 'high'
  channel?: 'alarm' | 'telemetry'
}): Promise<void> {
  // THE TEST IS INVERTED ON PURPOSE — `!== 'alarm'`, not `=== 'telemetry'`. Only telemetry
  // callers pass `channel` explicitly; all 30 alarm callers rely on the default. So the
  // realistic authoring mistake is a MISSPELLED telemetry value, and under `=== 'telemetry'`
  // that misspelling routes per-request volume to the ALARM topic — silently rebuilding the
  // coupling this whole commit removes. Inverted, the same typo degrades to a lost scan ping,
  // which is the loss this file has already declared acceptable. TypeScript's union would
  // catch it, but `api/` sits outside every tsconfig and `npm run build` type-checks none of
  // it, so the union is a process guarantee and this is a structural one. PG-10's own thesis
  // is that a mechanism beats a detector; this applies it to the router itself.
  // ONE boolean drives BOTH values, so the label can never desync from the URL actually used
  // and mislabel a MISCONFIGURED line.
  const isTelemetry = channel !== 'alarm'
  // Log the topic ACTUALLY USED, not the raw argument: under the inverted test a misspelled
  // value routes to telemetry, and a line tagged with the typo would misreport which topic
  // the message went to.
  const label = isTelemetry ? 'telemetry' : 'alarm'
  const varName = isTelemetry ? 'NTFY_TELEMETRY_URL' : 'NTFY_URL'
  const url = isTelemetry ? process.env.NTFY_TELEMETRY_URL : process.env.NTFY_URL

  // PG-34: UNSET AND MISCONFIGURED ARE DIFFERENT STATES AND MUST NOT LOG ALIKE. These used to
  // share one early return at one level, so a `SET-BUT-NOT-HTTPS` value — which silently
  // disables every brake alarm in the product — was indistinguishable in the Vercel logs from
  // the documented off switch. Same defect class `5664d43` fixed one branch over: two outcomes
  // that differ in consequence must differ in LEVEL as well as in STRING.
  if (!url) {
    // The documented off switch. The ALARM line keeps its exact historical shape; the new
    // TELEMETRY line takes the canonical `[ntfy:telemetry]` prefix so that grepping the
    // channel returns the never-attempted case as well as the delivery outcomes — which is
    // precisely the state this deploy is in until NTFY_TELEMETRY_URL is set in Vercel.
    // AN EMPTY STRING LANDS HERE, NOT IN THE MISCONFIGURED BRANCH BELOW, and that is correct:
    // there is no URL to be wrong about, and "set but empty" in Vercel is indistinguishable
    // from unset for every practical purpose.
    console.log(isTelemetry ? '[ntfy:telemetry] skipped — NTFY_TELEMETRY_URL not configured' : '[ntfy] skipped — NTFY_URL not configured')
    return
  }
  if (!url.startsWith('https://')) {
    console.error(`[ntfy] MISCONFIGURED — ${varName} is set but not https; this channel is disabled`)
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        // HTTP headers must be ASCII-only — emoji cause ByteString errors on Vercel
        'Title': title.replace(/[^\x20-\x7E]/g, '').slice(0, 100),
        'Priority': priority,
      },
      body: message.slice(0, 500),
      signal: controller.signal,
    })
    // A DROPPED ALARM USED TO LOG EXACTLY LIKE A DELIVERED ONE. This was a single
    // unconditional console.log at one level, so a 429 (ntfy's own rate limit) or a 5xx was
    // INDISTINGUISHABLE in the Vercel logs from a delivered priority-high alarm. Only a
    // network failure was visible, because the catch below logs at error.
    //
    // THAT IS THE FAILURE MODE THE BRAKES EXIST TO PREVENT. Every spend brake in this project
    // reports through this function ON THE ALARM CHANNEL — bulk-import (b5a9ff1),
    // generate-host-picks (08941f7), geocode (82aeabd), import-listing, create-booking's flood
    // alarm, guest-chat, daily-greeting, city-events, welcome-claim's failed-claim detector,
    // and every cron-spend-audit alert. A silently dropped alarm means the operator believes
    // they are being watched when they are not. The per-request TELEMETRY pings now ride a
    // separate topic, so their volume can no longer cost an alarm its delivery.
    //
    // OBSERVABILITY ONLY — no retry, no throw, no signature change. Every one of those call
    // sites relies on this function never failing them, and several are inside a request path
    // a guest is waiting on.
    //
    // WARN, not ERROR: a dropped alarm is a degraded signal, not a broken request, and the
    // catch below keeps error for the case where the POST did not complete at all — so the
    // three outcomes stay distinguishable by LEVEL as well as by STRING.
    //
    // BOTH GATES SPLIT ON THIS AND AGREED ON THE TRIGGER, so the condition is recorded rather
    // than the preference: warn is correct only because NOTHING ON THIS PROJECT FILTERS BY
    // LEVEL today — crons are read by hand from the Vercel runtime logs. **If a log drain,
    // Sentry, or any level-filtered alerting is ever added, THIS LINE MUST BECOME error IN
    // THAT SAME CHANGE**, because warn is the level such tooling samples away by default and
    // the fix would silently un-fix itself. The strings already differ, so promoting the
    // level costs no distinguishability.
    //
    // The CHANNEL is named on both lines so the two topics are tellable apart in the Vercel
    // logs — without it, a quiet alarm topic and a quiet telemetry topic read identically.
    if (res.ok) {
      console.log(`[ntfy:${label}] sent status`, res.status)
    } else {
      console.warn(`[ntfy:${label}] NOT DELIVERED — status`, res.status)
    }
  } catch (err) {
    console.error(
      `[ntfy:${label}] send error:`,
      (err instanceof Error ? err.message : 'unknown').slice(0, 120),
    )
  } finally {
    clearTimeout(timer)
  }
}
