import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isCronAuthorized } from './_lib/cron.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  res.status(200).json({ message: 'cron-refresh-guides stub' })
}
