import type { VercelRequest } from '@vercel/node'

// Vercel auto-sends `Authorization: Bearer <CRON_SECRET>` to cron paths when
// CRON_SECRET is set in project env. Fail closed if the secret is missing —
// never allow an unauthenticated call through.
export function isCronAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}
