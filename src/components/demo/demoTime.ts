// Shared demo-countdown formatter, used by the Layout sidebar widget and the Dashboard
// banner. Pure: pass `now` (ms) so callers can drive a live tick. Returns a clamped,
// human label; `expired` once the deadline has passed (or no deadline / bad date).
export function demoRemaining(expiresAt: string | null | undefined, now: number): {
  expired: boolean
  label: string
} {
  if (!expiresAt) return { expired: false, label: '' }
  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return { expired: false, label: '' }
  if (ms <= 0) return { expired: true, label: 'Demo ended' }

  const totalMin = Math.floor(ms / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60

  let label: string
  if (days >= 1) label = `${days}d ${hours}h left`
  else if (hours >= 1) label = `${hours}h ${mins}m left`
  else label = `${mins}m left`
  return { expired: false, label }
}
