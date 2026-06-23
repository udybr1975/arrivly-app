// SSRF-hardened fetch for host-pasted iCal URLs (apartments.ical_urls).
//
// THREAT MODEL: a malicious host pastes an iCal URL pointing at an internal or
// cloud-metadata address (169.254.169.254, 127.0.0.1, 10/8, ::1, fc00::/7, …).
// Our server fetches from a TRUSTED network position, so a naive `fetch(url)` is a
// Server-Side Request Forgery hole: the attacker reads internal services / instance
// credentials through our function. Both api/sync-ical.ts (interactive) and
// api/cron-sync-ical.ts (cron) call through here, so one choke point covers both.
//
// WHY lookup-TIME VALIDATION (not "resolve hostname, check IP, then fetch hostname"):
// the pre-resolve approach has a TOCTOU / DNS-rebinding gap — between our check and
// the kernel's own resolution the DNS answer can change, so the socket connects to a
// DIFFERENT address than the one we validated. By passing a custom `lookup` to
// https.request and validating INSIDE it, the kernel connects to the EXACT address we
// approved (we hand it back the validated address). There is no second resolution to
// rebind. We also re-run scheme + lookup validation on every manual redirect hop.
//
// FAILURE SHAPE (consistent, documented): a real HTTP response — 2xx OR non-2xx — is
// RETURNED as { ok, status, text } (caller maps non-2xx to a host string). Every other
// outcome (non-https scheme, blocked address, timeout, body too large, redirect-cap,
// transport error, bad URL) THROWS a generic Error whose message NEVER contains the URL
// or any part of it (iCal URLs can embed auth tokens — they must never be logged,
// thrown, or echoed). The caller turns a throw into a generic provider-label string.

import * as https from 'node:https'
import * as dns from 'node:dns'
import type { LookupFunction } from 'node:net'

const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MB — iCal feeds are tiny; stops infinite streams
const MAX_REDIRECTS = 3
const USER_AGENT = 'Arrivly/1.0 iCal Sync'

// ── Address parsing + blocklist (integer/range math, default-deny on unparseable) ──

function ipv4ToInt(s: string): number | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let v = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    v = v * 256 + n
  }
  return v >>> 0
}

function isBlockedV4Int(ip: number): boolean {
  // [networkBase, prefixBits]
  const ranges: Array<[number, number]> = [
    [0x00000000, 8],  // 0.0.0.0/8       "this network"
    [0x0a000000, 8],  // 10.0.0.0/8      private
    [0x64400000, 10], // 100.64.0.0/10   CGNAT
    [0x7f000000, 8],  // 127.0.0.0/8     loopback
    [0xa9fe0000, 16], // 169.254.0.0/16  link-local + cloud metadata
    [0xac100000, 12], // 172.16.0.0/12   private
    [0xc0000000, 24], // 192.0.0.0/24    IETF protocol assignments
    [0xc0a80000, 16], // 192.168.0.0/16  private
    [0xc6120000, 15], // 198.18.0.0/15   benchmarking
    [0xe0000000, 4],  // 224.0.0.0/4     multicast
    [0xf0000000, 4],  // 240.0.0.0/4     reserved
  ]
  for (const [base, bits] of ranges) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((ip & mask) >>> 0) === ((base & mask) >>> 0)) return true
  }
  return false
}

// Parse an IPv6 string to its 16 bytes, or null if unparseable. Handles :: compression,
// an embedded IPv4 tail (::ffff:1.2.3.4), and zone ids.
function parseIPv6(input: string): number[] | null {
  let s = input
  const pct = s.indexOf('%')
  if (pct !== -1) s = s.slice(0, pct)

  // Embedded IPv4 tail → rewrite as two hextets so the rest parses uniformly.
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = ipv4ToInt(s.slice(lastColon + 1))
    if (v4 === null) return null
    const hi = ((v4 >>> 16) & 0xffff).toString(16)
    const lo = (v4 & 0xffff).toString(16)
    s = s.slice(0, lastColon + 1) + hi + ':' + lo
  }

  const halves = s.split('::')
  if (halves.length > 2) return null

  const toHextets = (part: string): number[] | null => {
    if (part.length === 0) return []
    const out: number[] = []
    for (const h of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }

  const head = toHextets(halves[0])
  if (head === null) return null

  let hextets: number[]
  if (halves.length === 2) {
    const tail = toHextets(halves[1])
    if (tail === null) return null
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    hextets = [...head, ...Array(fill).fill(0), ...tail]
  } else {
    hextets = head
  }
  if (hextets.length !== 8) return null

  const bytes: number[] = []
  for (const h of hextets) {
    if (h < 0 || h > 0xffff) return null
    bytes.push((h >> 8) & 0xff, h & 0xff)
  }
  return bytes
}

function isBlockedV6Bytes(b: number[]): boolean {
  const head15Zero = b.slice(0, 15).every((x) => x === 0)
  if (head15Zero && b[15] === 1) return true // ::1 loopback
  if (b.every((x) => x === 0)) return true   // :: unspecified

  // IPv4-mapped ::ffff:0:0/96 → re-check the embedded v4.
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    const v4 = ((b[12] << 24) | (b[13] << 16) | (b[14] << 8) | b[15]) >>> 0
    return isBlockedV4Int(v4)
  }
  if ((b[0] & 0xfe) === 0xfc) return true                   // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true  // fe80::/10 link-local
  return false
}

function isBlockedAddress(ip: string, family: number): boolean {
  try {
    if (family === 4) {
      const v = ipv4ToInt(ip)
      return v === null ? true : isBlockedV4Int(v)
    }
    if (family === 6) {
      const b = parseIPv6(ip)
      return b === null ? true : isBlockedV6Bytes(b)
    }
    // Unknown family — try both shapes, default-deny if neither parses.
    const v = ipv4ToInt(ip)
    if (v !== null) return isBlockedV4Int(v)
    const b = parseIPv6(ip)
    if (b !== null) return isBlockedV6Bytes(b)
    return true
  } catch {
    return true // default-deny
  }
}

// Custom DNS lookup: resolve ALL addresses, block the connect if ANY is private/blocked,
// then hand the kernel back the validated address(es). Connect pins to what we approved.
const safeLookup = (hostname: string, options: any, cb: (...args: any[]) => void): void => {
  const lookupOpts: dns.LookupAllOptions = { all: true }
  if (options && (options.family === 4 || options.family === 6)) lookupOpts.family = options.family
  dns.lookup(hostname, lookupOpts, (err, addresses) => {
    if (err) { cb(err); return }
    if (!addresses || addresses.length === 0) { cb(new Error('blocked')); return }
    for (const a of addresses) {
      if (isBlockedAddress(a.address, a.family)) { cb(new Error('blocked')); return }
    }
    if (options && options.all) {
      cb(null, addresses)
    } else {
      cb(null, addresses[0].address, addresses[0].family)
    }
  })
}

interface OnceResult {
  statusCode: number
  body?: string
  redirectLocation?: string
}

// One request hop. Resolves on a received HTTP response (or a 3xx with Location to
// follow); rejects generically (no URL) on transport error, timeout, or oversize body.
function requestOnce(u: URL, timeoutMs: number): Promise<OnceResult> {
  return new Promise<OnceResult>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (fn: (a: any) => void, arg: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(arg)
    }

    const req = https.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup as unknown as LookupFunction,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/calendar, text/plain, */*' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume() // drain & discard — we re-validate the target before following
          finish(resolve, { statusCode: status, redirectLocation: res.headers.location })
          return
        }
        let received = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > MAX_BODY_BYTES) {
            req.destroy()
            finish(reject, new Error('too_large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => finish(resolve, { statusCode: status, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', () => finish(reject, new Error('request_failed')))
      }
    )

    timer = setTimeout(() => {
      req.destroy()
      finish(reject, new Error('timeout'))
    }, timeoutMs)

    req.on('error', () => finish(reject, new Error('request_failed')))
    req.end()
  })
}

/**
 * SSRF-safe GET of an iCal URL. Returns { ok, status, text } for any real HTTP response
 * (2xx or not); THROWS a generic, URL-free Error for non-https schemes, blocked/private
 * destinations, timeouts, oversize bodies, redirect-cap, or transport errors.
 */
export async function safeFetchIcal(rawUrl: string): Promise<{ ok: boolean; status: number; text: string }> {
  const deadline = Date.now() + TIMEOUT_MS
  let current = rawUrl
  let redirects = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let u: URL
    try {
      u = new URL(current)
    } catch {
      throw new Error('invalid_url')
    }
    if (u.protocol !== 'https:') throw new Error('scheme_blocked')

    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('timeout')

    const result = await requestOnce(u, remaining)

    if (result.redirectLocation) {
      if (redirects >= MAX_REDIRECTS) throw new Error('too_many_redirects')
      redirects++
      let next: string
      try {
        next = new URL(result.redirectLocation, u).toString()
      } catch {
        throw new Error('bad_redirect')
      }
      current = next
      continue
    }

    return {
      ok: result.statusCode >= 200 && result.statusCode <= 299,
      status: result.statusCode,
      text: result.body ?? '',
    }
  }
}
