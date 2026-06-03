import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
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

// Uploads to the public 'apartment-images' bucket with the host's access token
// attached explicitly. The storage write RLS policy requires auth.uid() to equal
// the first path segment ({hostId}/...). Relying on the SDK's implicit auth was
// sending the request unauthenticated (anon), which the policy correctly rejected.
// Attaching the same bearer token our /api calls already use guarantees the
// request is authenticated. Signature unchanged so callers are unaffected.
export async function uploadImage(file: File, path: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Your session has expired — please log in again, then retry.')

  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'x-upsert': 'true',
      'cache-control': 'max-age=3600',
      'content-type': file.type,
    },
    body: file,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const msg = (() => { try { return JSON.parse(detail)?.message } catch { return null } })()
    throw new Error(msg || detail || `Upload failed (HTTP ${res.status})`)
  }
  return path
}
