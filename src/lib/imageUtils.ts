import { supabase } from './supabase'

// Neutral, warm interior fallback when a host hasn't set a hero image yet.
export const FALLBACK_HERO = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80'

// Full http(s) URL → used as-is. Otherwise treated as a path in the public
// 'apartment-images' bucket. Empty/null → fallback.
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return FALLBACK_HERO
  if (url.startsWith('https://')) return url
  const { data } = supabase.storage.from('apartment-images').getPublicUrl(url)
  return data.publicUrl
}
