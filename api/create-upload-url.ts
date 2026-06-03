import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'apartment-images'
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(500).json({ error: 'Upload service not configured' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return res.status(401).json({ error: 'Unauthorized' })
  const userId = authData.user.id

  const body = (req.body ?? {}) as { kind?: string; apartmentId?: string; ext?: string }
  const ext = String(body.ext ?? '').toLowerCase()
  if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'Unsupported file type' })
  const safeExt = ext === 'jpeg' ? 'jpg' : ext

  // Service-role client: not subject to the storage token issue, and used only
  // to verify ownership and mint the signed upload URL. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)

  let path: string
  if (body.kind === 'hero') {
    const apartmentId = body.apartmentId
    if (!apartmentId || typeof apartmentId !== 'string') {
      return res.status(400).json({ error: 'apartmentId is required' })
    }
    const { data: apt } = await admin
      .from('apartments')
      .select('id')
      .eq('id', apartmentId)
      .eq('host_id', userId)
      .maybeSingle()
    if (!apt) return res.status(404).json({ error: 'Apartment not found' })
    path = `${userId}/${apartmentId}/hero-${Date.now()}.${safeExt}`
  } else if (body.kind === 'logo') {
    path = `${userId}/logo-${Date.now()}.${safeExt}`
  } else {
    return res.status(400).json({ error: 'Invalid kind' })
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return res.status(500).json({ error: 'Could not create upload URL' })

  return res.status(200).json({ path: data.path, token: data.token })
}
