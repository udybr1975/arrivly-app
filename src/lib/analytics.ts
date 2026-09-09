/**
 * Google Analytics 4 — consent-gated, and STRUCTURALLY absent from guest surfaces.
 *
 * TWO INDEPENDENT GATES, AND BOTH ARE LOAD-BEARING:
 *
 *  1. ROUTE. `isTrackedRoute()` returns false for `/guest*`, `/w/*`, `/legal/guest-notice*`,
 *     `/auth/callback` and `/reset-password`, matched case-insensitively. On those routes this
 *     module refuses to inject the gtag script AT ALL — not "loads it and suppresses hits". A
 *     guest therefore downloads no Google script, receives no `_ga` cookie and never appears in
 *     the property, whatever consent value sits in their localStorage (a host who accepted on
 *     the dashboard and then opened their own guest page is the real case). The list is not all
 *     guest ROUTES: `/legal/guest-notice` is a guest SURFACE reached by <Link> from every guest
 *     screen, and the two auth paths carry a SUPABASE TOKEN IN THE URL FRAGMENT
 *     (`#access_token=…`, `type=recovery`). All are excluded for the same fail-closed reason.
 *
 *  2. CONSENT. The script is injected only after an explicit 'granted' choice is stored. No
 *     stored choice = nothing loads. 'denied' = nothing loads, ever, and nothing is sent.
 *
 * AN ENTRY GATE IS NOT A LIFETIME GATE — THE INVARIANT THAT KEEPS GATE 1 TRUE.
 * Once injected, gtag.js lives for the life of the DOCUMENT and its enhanced-measurement hits
 * (scroll, outbound click, form_start — property-side settings, on by default) read
 * `window.location.href` themselves. So an in-app SPA transition from a tracked route INTO
 * `/guest` would carry a live script onto a token-bearing URL. Two things prevent it, and both
 * must be preserved: every guest link in the app is a FULL DOCUMENT LOAD (`<a href>` or
 * `window.location.replace`), and `AnalyticsTracker` in App.tsx forces a full load if it ever
 * observes an untracked route with the script already up. NEVER add a react-router `<Link to>`
 * or `<Navigate to>` into `/guest` or `/w/` — that is the one edit that breaks the published
 * promise, and it would break it silently.
 *
 * NOTHING IDENTIFYING EVER LEAVES, AND URLS ARE THE WHOLE RISK ON THIS PROJECT. Guest tokens
 * and welcome codes ride in query strings and fragments; an APARTMENT UUID rides in the PATH
 * (`/dashboard/property/:aptId`). So:
 *   - `page_location` is built from a NORMALISED PATHNAME — no query, no fragment, and every
 *     UUID segment replaced by `:id`. This is set via `gtag('set', …)` so it also governs the
 *     hits gtag generates on its own, which would otherwise read the raw href.
 *   - `page_referrer` is passed through ONLY when it is cross-origin (the acquisition source,
 *     which is the useful part and can never be a guest URL). A same-origin referrer is
 *     replaced by the bare origin root — NOT by `''`, which is falsy and would leave the
 *     suppression depending on how a third-party script treats an empty value. That is exactly
 *     how a guest URL would otherwise escape: `document.referrer` survives a pushState
 *     navigation, so a guest tapping the privacy-notice link off a token-bearing guest URL
 *     would carry it along.
 *   - Funnel events carry NO parameters at all: `trackEvent(name: string)` takes no payload, so
 *     adding one is a type error rather than a judgement call.
 */
import { ARRIVLY_CONFIG } from '../config'

const CONSENT_KEY = 'bemgu_analytics_consent'

export type ConsentChoice = 'granted' | 'denied'

/**
 * Routes on which analytics may run. False for every guest-facing surface AND for the two
 * auth routes that carry a Supabase token in the fragment.
 *
 * PREFIX TESTS, DELIBERATELY, so it fails CLOSED: a future `/guest/anything` inherits the
 * exclusion automatically. The cost is that a hypothetical `/guestbook` would also be
 * excluded, which is the harmless direction.
 */
/**
 * Canonicalise a pathname BEFORE any prefix test or transmission.
 *
 * THREE THINGS, and each closed a real evasion of the guest gate:
 *   - lowercase, because react-router matches routes CASE-INSENSITIVELY by default
 *     (`caseSensitive = false`, verified in the installed react-router 7.18 build), so
 *     `/Guest?apt=…&token=…` renders GuestPage while a case-sensitive prefix test waves it
 *     through — the gate reading as fail-closed while being open;
 *   - percent-decode, so `/%2Fw/CODE` cannot hide a doubled slash inside an escape;
 *   - collapse repeated slashes, so `//w/CODE` cannot slip past a `startsWith('/w/')` test.
 *
 * The last two matter because react-router matches NEITHER `//w/CODE` nor `/%2Fw/CODE` to a
 * route — the page renders blank — while the un-canonicalised gate called them TRACKED and the
 * un-canonicalised normaliser passed the welcome code straight through into the transmitted
 * URL (a welcome code is not a UUID, so the UUID pass does not mask it). It is applied in BOTH
 * `isTrackedRoute` and `normalizePath`, and the second is the one that matters most: that is
 * the function which builds the string actually sent.
 */
function canonicalPath(pathname: string): string {
  let p = pathname
  // DECODE UNTIL STABLE, NOT ONCE. A single decode leaves `/%252Fw/CODE` as `/%2Fw/CODE` — no
  // doubled slash to collapse, so the gate calls it TRACKED and the normaliser transmits the
  // welcome code verbatim (a welcome code is not a UUID, so the UUID pass does not mask it).
  // React-router matches none of these, so the page is blank and the code is never USED — but
  // it would still be sent, which is the whole failure this canonicaliser exists to stop, one
  // encoding layer up. Bounded at 3 passes: enough for any realistic double/triple encoding,
  // and a hard stop rather than a loop an attacker could lengthen.
  for (let i = 0; i < 3; i++) {
    let next = p
    try {
      next = decodeURIComponent(p)
    } catch {
      // Malformed escape — keep what we have. The collapse and prefix tests still run, so this
      // degrades to "no worse than before", never to open.
      break
    }
    if (next === p) break
    p = next
  }
  return p.toLowerCase().replace(/\/{2,}/g, '/')
}

export function isTrackedRoute(pathname: string): boolean {
  if (typeof pathname !== 'string') return false
  const p = canonicalPath(pathname)
  return !(
    p.startsWith('/guest') ||
    p.startsWith('/w/') ||
    p.startsWith('/auth/callback') ||
    p.startsWith('/reset-password') ||
    // A GUEST SURFACE THAT IS NOT A GUEST ROUTE. `GuestLegalLink` is a react-router <Link>
    // rendered on EVERY guest and welcome state, so this page is reached by guests, from
    // inside the guest experience — and it is the page that tells them they are not tracked.
    // Bemgu is a PROCESSOR for guest data; asking a guest for analytics consent here is the
    // wrong side of that role split, quite apart from the cookie.
    p.startsWith('/legal/guest-notice')
  )
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A path safe to send: every UUID segment collapsed to `:id`.
 *
 * `/dashboard/property/:aptId` is the only identifier-bearing tracked route today, but this is
 * written over the VALUE SHAPE rather than that one route, so a new `/dashboard/x/<uuid>` route
 * is covered the day it is added. It also makes the GA report readable — one row for the
 * property editor instead of one row per property.
 */
export function normalizePath(pathname: string): string {
  if (typeof pathname !== 'string' || pathname === '') return '/'
  return canonicalPath(pathname)
    .split('/')
    .map(seg => (UUID_SEGMENT.test(seg) ? ':id' : seg))
    .join('/')
}

/**
 * The ONLY query parameters that may ever be transmitted: the four standard UTM campaign keys.
 *
 * AN ALLOWLIST, NEVER A DENYLIST, and the difference is the whole point on this project —
 * booking tokens (`?token=`), QR keys (`?key=`), apartment ids (`?apt=`) and Stripe's
 * `?checkout=` all ride in query strings, so a rule that names what to REMOVE is one new
 * parameter away from leaking. This names what may STAY; everything else, known or not yet
 * invented, is dropped by default.
 *
 * Values are re-encoded through URLSearchParams, and each is length-capped: a UTM value is
 * attacker-supplyable by anyone who can craft a link to the site, and an unbounded one would
 * be an unbounded string forwarded to two analytics vendors.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const
const UTM_MAX_LEN = 120

export function normalizeQuery(search: string): string {
  if (typeof search !== 'string' || search === '') return ''
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return ''
  }
  const kept = new URLSearchParams()
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) kept.set(key, value.slice(0, UTM_MAX_LEN))
  }
  const out = kept.toString()
  return out ? `?${out}` : ''
}

/** The stored choice, or null when the visitor has not chosen yet. */
export function getConsent(): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    return raw === 'granted' || raw === 'denied' ? raw : null
  } catch {
    // Private mode / storage blocked. No stored choice means nothing loads — fail closed.
    return null
  }
}

export function setConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_KEY, choice)
  } catch {
    // Nothing to do: without persistence the banner simply asks again next visit, which is
    // the correct failure — it never loads the script on the strength of an unstored yes.
  }
}

let injected = false

/** Whether gtag.js has been injected into THIS document. */
export function isAnalyticsLoaded(): boolean {
  return injected
}

type GtagFn = (...args: unknown[]) => void

/**
 * The canonical gtag shim. It pushes the `arguments` OBJECT, not an array — that is Google's
 * documented contract. An array is widely reported to work and is not what gtag.js promises to
 * accept, and the failure mode if it ever stops working is total and silent: no data, ever,
 * with no error anywhere. Declared with no formal parameters (so `arguments` is legal) and
 * cast to the call signature callers need.
 */
const gtag: GtagFn = function () {
  const w = window as unknown as { dataLayer?: unknown[] }
  w.dataLayer = w.dataLayer ?? []
  w.dataLayer.push(arguments)
} as GtagFn

function currentPathname(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

/**
 * The referrer, but only when it points OFF this origin.
 *
 * A cross-origin referrer is the acquisition source (a search engine, a social post) and is
 * what makes the property worth having. A SAME-ORIGIN referrer is the danger, and it is
 * reachable with a REAL booking token, not just the public demo: `GuestPage` does
 * `window.location.replace('/guest?apt=…&token=…')`, so that token-bearing URL becomes
 * `document.referrer`; the guest then taps the privacy-notice <Link>, and `document.referrer`
 * is unchanged by a pushState navigation. Welcome codes (`/w/XJ8SSKFH`) travel the same way.
 *
 * A SAME-ORIGIN REFERRER IS REPLACED WITH THE ORIGIN ROOT, NEVER WITH `''`. An empty string is
 * FALSY, and gtag.js builds its `dr` parameter from the configured value OR ELSE
 * `document.referrer` — so `''` is a suppression only if a minified third-party script happens
 * to distinguish present-but-empty from absent. Nothing here can prove that, and the failure
 * would be silent and total: the full guest URL in a Google request, with no error anywhere.
 * The origin root is non-falsy and carries no path, query or fragment, so it cannot be a
 * credential whatever gtag does with it. A privacy control must be a mechanism, not a bet on
 * someone else's falsy-value handling.
 *
 * An ABSENT referrer stays `''` — the fallback then reads an equally empty `document.referrer`,
 * so there is nothing to suppress and a fabricated internal referrer would only corrupt the
 * direct-traffic acquisition numbers this whole property exists to measure.
 */
function safeReferrer(): string {
  try {
    const ref = document.referrer
    if (!ref) return ''
    return new URL(ref).origin === window.location.origin
      ? `${window.location.origin}/`
      : ref
  } catch {
    return ''
  }
}

/**
 * Pin the location gtag reports, for THIS hit and every hit it generates on its own.
 *
 * `gtag('set', …)` is what makes the normalisation stick: an event-scoped `page_location` on
 * `page_view` does not persist to the enhanced-measurement events that follow it, and those
 * default to reading the raw `document.location.href`.
 */
function setPageContext(path: string): void {
  gtag('set', {
    // Path + UTM only. The fragment is never carried (it is not read here at all), and every
    // query parameter outside the UTM allowlist is dropped — see normalizeQuery.
    page_location: `${window.location.origin}${normalizePath(path)}${normalizeQuery(window.location.search)}`,
    page_referrer: safeReferrer(),
  })
}

/** True only when the script is loaded AND the current route is still a tracked one. */
function canSend(): boolean {
  return injected && getConsent() === 'granted' && isTrackedRoute(currentPathname())
}

/**
 * Inject gtag.js — only with granted consent, only on a tracked route, only once.
 * Safe to call on every navigation; both gates are re-checked each time.
 */
export function initAnalytics(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (injected) return
  if (getConsent() !== 'granted') return
  if (!isTrackedRoute(currentPathname())) return

  const id = ARRIVLY_CONFIG.analytics.measurementId
  if (!id) return

  injected = true

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(s)

  // ADVERTISING STORAGE IS DENIED IN CODE, NOT LEFT TO A SETTING IN GOOGLE'S UI. The published
  // policy says "we do not use advertising cookies"; with these three omitted they default to
  // granted, and whether an ad cookie is set would depend on a Google Signals toggle outside
  // this repo. A published promise and the code that backs it change together, or neither.
  gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  gtag('js', new Date())
  setPageContext(currentPathname())
  // send_page_view: false — page views are sent explicitly by trackPageView() against a
  // normalised, path-only location, so no query string, fragment or UUID reaches Google.
  // anonymize_ip is a Universal Analytics parameter, ignored by GA4: harmless, and deliberately
  // NOT relied on as a privacy control anywhere, in code or in the published policy.
  gtag('config', id, { send_page_view: false, anonymize_ip: true })
}

/** A page view for `path`. No-op without script, without consent, or on an untracked route. */
export function trackPageView(path: string): void {
  if (!isTrackedRoute(path)) return
  if (!canSend()) return
  setPageContext(path)
  gtag('event', 'page_view')
}

/**
 * A funnel event. Deliberately carries NO parameters — no ids, no email, nothing.
 *
 * Returns whether the event was actually sent, which `trackPropertyLiveOnce()` below needs:
 * a once-only latch must not be spent on a call that went nowhere.
 */
export function trackEvent(name: string): boolean {
  if (!canSend()) return false
  gtag('event', name)
  return true
}

const PROPERTY_LIVE_KEY = 'arrivly_ga_property_live'

/**
 * `property_live` — a host's FIRST property going live, AT MOST ONCE.
 *
 * TWO SITES REACH THIS AND THEY ARE NOT MUTUALLY EXCLUSIVE, which is the whole reason the
 * guard lives here rather than at either call site: `PropertySetup` creates a property with
 * `is_visible: true`, and `Dashboard`'s card menu flips an existing draft false -> true. A host
 * can do one, then the other.
 *
 * Each caller first checks that NO OTHER apartment of theirs was already visible, which is what
 * makes the event mean "first property live". That test alone is not once-per-host, though:
 * publish, unpublish, publish again — or create A, unpublish A, create B — passes it a second
 * time. This latch closes that.
 *
 * IT IS PER-DEVICE, NOT PER-HOST, AND THAT CUTS BOTH WAYS. There is no server-side state to key
 * on, and the event carries no host identifier by design (that is the privacy property, and it
 * is not being traded away for a cleaner count). So: a host publishing their first property from
 * a second browser contributes a SECOND event (over-count), and — the mirror case, which is
 * easier to miss — if two different accounts share one browser profile (a demo sandbox signup,
 * or the admin account followed by a real host on the same machine) the second account's genuine
 * first publish is SWALLOWED by a latch the first one set (under-count). Both accepted: this is
 * a marketing funnel metric, and the only fix for either direction is sending an identifier.
 *
 * THE LATCH IS SPENT ONLY ON A REAL SEND. If consent is absent the event does not go, and
 * burning the latch there would mean a host who accepts analytics later never fires it at all.
 */
export function trackPropertyLiveOnce(): void {
  try {
    if (localStorage.getItem(PROPERTY_LIVE_KEY) === '1') return
  } catch {
    // Storage unreadable: fall through and rely on the callers' "no other visible property"
    // test. A duplicate in a locked-down browser beats a silently missing funnel step.
  }
  if (!trackEvent('property_live')) return
  try {
    localStorage.setItem(PROPERTY_LIVE_KEY, '1')
  } catch {
    // Unwritable storage means the latch cannot hold; the caller-side test still bounds it.
  }
}
