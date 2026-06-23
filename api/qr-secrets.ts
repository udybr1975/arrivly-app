import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Host-authenticated read of per-apartment QR secrets. apartment_qr_secrets is
// service-role-only (RLS, zero policies), so the host's client can't read it
// directly. This endpoint returns the secrets for ONLY the caller's own
// apartments — the host_id scoping is the gate; we never accept a client-
// supplied apartment-id list.
//
// POST (matches api/geocode.ts so the api helper can call it with its Bearer
// token). Body is ignored.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth — mirror api/geocode.ts exactly.
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!)
  const { data: authData, error: authError } = await sb.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })

  const userId = authData.user.id

  // Only AFTER auth passes do we build the service-role client.
  const svc = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  try {
    // Resolve the caller's own apartments — never trust a client-supplied list.
    const { data: apts, error: aptErr } = await svc
      .from('apartments')
      .select('id')
      .eq('host_id', userId)
    if (aptErr) {
      console.error('[qr-secrets] apt query', aptErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    const aptIds = (apts ?? []).map(a => a.id as string)
    if (aptIds.length === 0) return res.status(200).json({ secrets: {} })

    const { data: rows, error: secretErr } = await svc
      .from('apartment_qr_secrets')
      .select('apartment_id, qr_secret')
      .in('apartment_id', aptIds)
    if (secretErr) {
      console.error('[qr-secrets] secret query', secretErr.message?.slice(0, 120))
      return res.status(500).json({ error: 'query_failed' })
    }

    const secrets: Record<string, string> = {}
    for (const r of rows ?? []) {
      if (r.apartment_id && r.qr_secret) secrets[r.apartment_id as string] = r.qr_secret as string
    }

    return res.status(200).json({ secrets })
  } catch (e) {
    console.error('[qr-secrets] unexpected', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return res.status(500).json({ error: 'internal_error' })
  }
}
