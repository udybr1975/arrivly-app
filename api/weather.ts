import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendNtfy } from './_lib/ntfy.js'

/**
 * Server-side weather proxy (legal decision D4).
 *
 * WHY THIS EXISTS. The guest page used to fetch wttr.in DIRECTLY FROM THE GUEST'S
 * BROWSER, which handed the guest's IP address to a third party we do not control and
 * could not narrow. The published guest privacy notice now states that nothing about
 * the guest reaches the weather service, and the Art. 30 record's B10 row says the same.
 * This endpoint is what makes those sentences true. THE CLIENT-SIDE FETCH MUST NEVER
 * COME BACK — reintroducing it silently falsifies a published promise.
 *
 * IT TAKES AN APARTMENT ID, NOT COORDINATES, AND THAT IS THE LOAD-BEARING CHOICE.
 * Coordinates in a query string are written into VERCEL'S EDGE ACCESS LOG before any of
 * our code runs (the same mechanism behind the pre-arrival fragment rule), and exact
 * coordinates ARE the street address. Taking the apartment UUID — already public, and
 * already the key to `guest-bootstrap`'s public fields — keeps the address out of the
 * log entirely, gives the brake below a host to key on, and collapses the edge cache to
 * ONE entry per property instead of one per distinct coordinate pair. Do not "simplify"
 * this back to lat/lng params.
 *
 * SSRF: the upstream host is a hardcoded constant and the only values interpolated into
 * the URL are two numbers READ FROM OUR OWN DATABASE, re-serialised with String(number).
 * No caller-supplied string reaches the outbound request, and redirects are refused.
 * `_lib/safe-fetch` is deliberately NOT used: it exists for HOST-SUPPLIED iCal URLs,
 * where the hostname is the attacker-controlled part. Here the hostname is a constant.
 *
 * The response is four display fields; the rest of wttr.in's payload is dropped.
 */

const UPSTREAM_HOST = 'https://wttr.in'
const UPSTREAM_TIMEOUT_MS = 6_000

/**
 * Per-apartment, per-UTC-hour ceiling. VICTIM-KEYED: apartment UUIDs are public, so the
 * named host is whoever is being hammered, NOT the caller — the alarm says INVESTIGATE,
 * never "block this host" (the fa8fa32 rule). FAILS CLOSED, because the blocked
 * behaviour is the free fallback: the guest page simply renders without weather.
 * Registered in cron-spend-audit.ts's ROLLING_LIMITS at 3x this value in the SAME commit
 * — a brake is unfinished until its key is there, or the 429 fires while nothing alarms.
 */
const WEATHER_HOURLY_LIMIT = 60

/**
 * Every degraded outcome — absent, hidden, un-geocoded, braked, upstream down — answers
 * 200 with this body, and the client treats "no numeric temp" as "no weather".
 *
 * IT IS 200 ON PURPOSE. A 5xx is not reliably cached by the CDN, so an upstream outage
 * would become an unabsorbed retry storm against the very endpoint that has no vendor
 * key to protect it. But it is cached for ONE MINUTE, not thirty: a momentary wttr.in
 * blip must not blank the weather for every guest at that property for half an hour.
 */
const EMPTY = {}
const CACHE_OK = 'public, s-maxage=1800, stale-while-revalidate=3600'
const CACHE_DEGRADED = 'public, s-maxage=60, stale-while-revalidate=120'

/** 200 + empty body + the short TTL. Every degraded return goes through here. */
function degraded(res: VercelResponse) {
  res.setHeader('Cache-Control', CACHE_DEGRADED)
  return res.status(200).json(EMPTY)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type WeatherPayload = {
  temp: number
  condition: string
  isOutdoorWeather: boolean
  icon: string
}

/** A finite coordinate inside its range, or null. Values come from our own DB. */
function coord(raw: unknown, limit: number): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < -limit || n > limit) return null
  return n
}

/**
 * Map a wttr.in condition description onto the icon + "is this outdoor weather?" pair the
 * guest page uses. Kept behaviourally identical to the client-side branch it replaces, so
 * the page reads exactly as it did before the proxy.
 */
function classify(descRaw: string): { icon: string; isOutdoorWeather: boolean } {
  const desc = descRaw.toLowerCase()
  if (desc.includes('sunny') || desc.includes('clear')) return { icon: '☀️', isOutdoorWeather: true }
  if (desc.includes('partly')) return { icon: '⛅', isOutdoorWeather: true }
  if (desc.includes('overcast') || desc.includes('cloudy')) return { icon: '☁️', isOutdoorWeather: false }
  if (desc.includes('snow') || desc.includes('blizzard')) return { icon: '❄️', isOutdoorWeather: true }
  if (desc.includes('thunder') || desc.includes('storm')) return { icon: '⛈', isOutdoorWeather: false }
  if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) return { icon: '🌧', isOutdoorWeather: false }
  if (desc.includes('mist') || desc.includes('fog')) return { icon: '🌫', isOutdoorWeather: false }
  return { icon: '🌤', isOutdoorWeather: false }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const aptRaw = Array.isArray(req.query.apt) ? req.query.apt[0] : req.query.apt
  const apt = typeof aptRaw === 'string' ? aptRaw.trim() : ''
  if (!UUID_RE.test(apt)) return res.status(400).json({ error: 'invalid_apartment' })

  // Success is edge-cached for 30 minutes with an hour of stale-while-revalidate behind
  // it, and there is ONE cache key per property, so ordinary guest traffic reaches this
  // function about twice an hour. Degraded outcomes take the short TTL — see EMPTY.
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[weather] missing supabase config')
    return degraded(res)
  }
  const db = createClient(supabaseUrl, serviceKey)

  const { data: row, error: aptErr } = await db
    .from('apartments')
    .select('host_id, lat, lng, is_visible')
    .eq('id', apt)
    .maybeSingle()
  if (aptErr) {
    console.error('[weather] apt query', aptErr.message?.slice(0, 120))
    return degraded(res)
  }
  // Identical empty body for missing, hidden and un-geocoded — never an oracle for which.
  const aptRow = row as { host_id?: unknown; lat?: unknown; lng?: unknown; is_visible?: unknown } | null
  if (!aptRow || aptRow.is_visible !== true) return degraded(res)

  const lat = coord(aptRow.lat, 90)
  const lng = coord(aptRow.lng, 180)
  if (lat === null || lng === null) return degraded(res)

  // Brake, before the outbound call. See WEATHER_HOURLY_LIMIT.
  const hostId = typeof aptRow.host_id === 'string' ? aptRow.host_id : null
  if (hostId) {
    const { data: count, error: countErr } = await db.rpc('bump_api_counter', {
      p_host_id: hostId,
      p_endpoint: 'weather',
    })
    if (countErr) {
      console.warn('[weather] counter bump failed (fail-closed) -', countErr.message?.slice(0, 120))
      return degraded(res)
    }
    if (typeof count !== 'number') {
      console.error('[weather] bump_api_counter returned non-numeric - brake inactive', typeof count)
    } else if (count > WEATHER_HOURLY_LIMIT) {
      if (count === WEATHER_HOURLY_LIMIT + 1) {
        try {
          await sendNtfy({
            title: 'Bemgu spend alert: weather proxy',
            message:
              `Feature: Guest-page weather (/api/weather)\n` +
              `Host ${hostId} hit ${count} weather lookups this hour (limit ${WEATHER_HOURLY_LIMIT}).\n` +
              `Reachable with only an apartment UUID (public), so this host is most likely the\n` +
              `VICTIM of a flood, not its source. INVESTIGATE - do not auto-block this host.\n` +
              `No vendor key is spent here: the cost is Vercel invocations plus outbound calls\n` +
              `to wttr.in from the fra1 egress IPs. Blocked lookups degrade to "no weather".`,
            priority: 'default',
          })
        } catch {
          // An alarm that fails must never take the request with it.
        }
      }
      return degraded(res)
    }
  }

  // Rounded to ~1km before leaving us: all the weather needs, and it keeps this request
  // from being a second, more precise copy of the address. Built from NUMBERS only.
  const roundedLat = Math.round(lat * 100) / 100
  const roundedLng = Math.round(lng * 100) / 100
  const url = `${UPSTREAM_HOST}/${String(roundedLat)},${String(roundedLng)}?format=j1`

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(url, {
      signal: ac.signal,
      redirect: 'error',
      // ASCII-only header values (the ByteString rule).
      headers: { Accept: 'application/json', 'User-Agent': 'Bemgu/1.0 (+https://bemgu.app)' },
    })
    if (!upstream.ok) {
      console.error('[weather] upstream status', upstream.status)
      return degraded(res)
    }
    const data = (await upstream.json()) as {
      current_condition?: Array<{ temp_C?: unknown; weatherDesc?: Array<{ value?: unknown }> }>
    }
    const cur = data.current_condition?.[0]
    const tempRaw = Number(cur?.temp_C)
    if (!cur || !Number.isFinite(tempRaw)) return degraded(res)

    const descRaw = typeof cur.weatherDesc?.[0]?.value === 'string' ? cur.weatherDesc[0].value : ''
    const desc = descRaw.trim().slice(0, 60)
    const { icon, isOutdoorWeather } = classify(desc)
    res.setHeader('Cache-Control', CACHE_OK)
    const payload: WeatherPayload = {
      temp: Math.round(tempRaw),
      condition: desc.charAt(0).toUpperCase() + desc.slice(1).toLowerCase(),
      isOutdoorWeather,
      icon,
    }
    return res.status(200).json(payload)
  } catch (e) {
    // Never surface upstream detail; the guest page degrades to no weather.
    console.error('[weather] fetch failed', e instanceof Error ? e.name : 'unknown')
    return degraded(res)
  } finally {
    clearTimeout(timer)
  }
}
