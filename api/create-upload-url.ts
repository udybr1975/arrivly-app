import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'apartment-images'
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp'])
// Per-kind declared-size caps. Defence-in-depth only: an honest client gets a
// clean 400 before a signed URL is minted, and the per-kind intent (which a single
// bucket file_size_limit cannot express) is checked here. NOT the security
// boundary — a hostile caller can lie about the declared size, which is exactly
// why the bucket-level cap is the authoritative gate.
const MAX_BYTES_HERO = 5 * 1024 * 1024
const MAX_BYTES_LOGO = 2 * 1024 * 1024

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

  const body = (req.body ?? {}) as { kind?: string; apartmentId?: string; ext?: string; size?: number }
  const ext = String(body.ext ?? '').toLowerCase()
  if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'Unsupported file type' })
  const safeExt = ext === 'jpeg' ? 'jpg' : ext

  // Service-role client: not subject to the storage token issue, and used only
  // to verify ownership and mint the signed upload URL. Never returned to client.
  const admin = createClient(supabaseUrl, serviceKey)

  let path: string
  let maxBytes: number
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
    maxBytes = MAX_BYTES_HERO
  } else if (body.kind === 'logo') {
    path = `${userId}/logo-${Date.now()}.${safeExt}`
    maxBytes = MAX_BYTES_LOGO
  } else {
    return res.status(400).json({ error: 'Invalid kind' })
  }

  // Declared-size pre-check (defence-in-depth; the bucket cap is authoritative).
  // Only reject a finite numeric size over the cap — a missing/non-numeric size
  // must NOT block, so a client that omits the field still works.
  const declaredSize = Number(body.size)
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    return res.status(400).json({ error: 'file_too_large', maxBytes })
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return res.status(500).json({ error: 'Could not create upload URL' })

  return res.status(200).json({ path: data.path, token: data.token })
}
