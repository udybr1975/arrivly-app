import { supabase } from './supabase'
import { api } from './api'

const BUCKET = 'apartment-images'

// Neutral, warm interior fallback when a host hasn't set a hero image yet.
export const FALLBACK_HERO = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80'

// Full http(s) URL → used as-is. Otherwise treated as a path in the public
// 'apartment-images' bucket. Empty/null → fallback.
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return FALLBACK_HERO
  if (url.startsWith('https://')) return url
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(url)
  return data.publicUrl
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

// Storage rejects the host's login token directly on this project (authenticated
// uploads are seen as anonymous and the write RLS policy refuses them). So a
// server route authorises the host and returns a one-time signed upload URL
// minted with the service key; the file is then sent to that signed URL, which
// carries its own authorisation. The server builds the path from the verified
// host id, so the client cannot choose where files land. Returns the stored path.
export async function uploadImage(
  file: File,
  kind: 'hero' | 'logo',
  apartmentId?: string,
): Promise<string> {
  const ext = MIME_TO_EXT[file.type]
  if (!ext) throw new Error('Use a PNG, JPG or WebP image.')

  const { path, token } = await api.post<{ path: string; token: string }>(
    '/create-upload-url',
    { kind, apartmentId, ext },
  )

  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type })
  if (error) throw error
  return path
}
