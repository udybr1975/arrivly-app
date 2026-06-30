// Shared Unsplash "city default image" fetcher. Best-effort: NEVER throws, NEVER logs
// the access key. Used by api/city-image.ts (host editor path) and api/demo-create.ts
// (demo seeding). Returns null on: missing key, empty city, non-2xx, no results,
// timeout, or any throw. Logic moved verbatim from the former inline block in
// api/city-image.ts.

interface UnsplashPhoto {
  urls: { raw: string }
  user: { name: string; links: { html: string } }
  links: { download_location: string }
}
interface UnsplashSearch {
  results?: UnsplashPhoto[]
}

const APP_NAME = 'Arrivly'

export async function fetchCityImage(city: string): Promise<{ imageUrl: string; credit: string } | null> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY
  if (!accessKey) return null
  const c = (city ?? '').trim()
  if (!c) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const query = encodeURIComponent(`${c} city`)
    const searchUrl = `https://api.unsplash.com/search/photos?query=${query}&per_page=10&orientation=landscape&content_filter=high`
    const r = await fetch(searchUrl, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: controller.signal,
    })
    if (!r.ok) return null

    const data = (await r.json()) as UnsplashSearch
    const photo = data.results?.[0]
    if (!photo) return null

    const imageUrl = `${photo.urls.raw}&w=1600&q=80&auto=format&fit=crop`
    const utm = `utm_source=${APP_NAME}&utm_medium=referral`
    const photographerUrl = photo.user.links.html.startsWith('https://') ? photo.user.links.html : 'https://unsplash.com'
    const credit = JSON.stringify({
      name: photo.user.name,
      userLink: `${photographerUrl}?${utm}`,
      unsplashLink: `https://unsplash.com/?${utm}`,
    })

    // Unsplash guideline: register a download when a photo is used. Best-effort.
    if (photo.links.download_location.startsWith('https://api.unsplash.com/')) {
      fetch(`${photo.links.download_location}?client_id=${accessKey}`).catch(() => {})
    }

    return { imageUrl, credit }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
