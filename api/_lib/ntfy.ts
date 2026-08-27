export async function sendNtfy({
  title,
  message,
  priority,
}: {
  title: string
  message: string
  priority: 'default' | 'high'
}): Promise<void> {
  const url = process.env.NTFY_URL
  if (!url || !url.startsWith('https://')) {
    console.log('[ntfy] skipped — NTFY_URL not configured')
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
    // reports through this function — bulk-import (b5a9ff1), generate-host-picks (08941f7),
    // geocode (82aeabd), import-listing, create-booking's flood alarm, guest-chat,
    // daily-greeting, city-events, welcome-claim, and every cron-spend-audit alert. A silently
    // dropped alarm means the operator believes they are being watched when they are not.
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
    if (res.ok) {
      console.log('[ntfy] sent status', res.status)
    } else {
      console.warn('[ntfy] NOT DELIVERED — status', res.status)
    }
  } catch (err) {
    console.error(
      '[ntfy] send error:',
      (err instanceof Error ? err.message : 'unknown').slice(0, 120),
    )
  } finally {
    clearTimeout(timer)
  }
}
