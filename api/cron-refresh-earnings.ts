import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isCronAuthorized } from './_lib/cron.js'
import { withRetry } from './_lib/retry.js'

// Daily cron (05:30 UTC). Stage 5 (Phase I) — pulls the last 14 days of Tiqets Reporting
// orders + refunds and ingests per-campaign commission rows into public.experience_orders,
// so the host Earnings panel can eventually show VERIFIED euros (not just click counts).
//
// Defensive by design: the exact Tiqets response shape is UNVERIFIED (our token is not yet
// authorized for the Reporting API — this returns 401 today). The cron therefore NEVER
// throws and NEVER logs the token/headers; a non-OK fetch just returns { ok:false }.
//
// PII: only a strict allowlist of commercial fields is written to `raw` (see PII_KEYS) —
// no customer/buyer name, email, phone, address, or IP is ever stored.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TIQETS_ORDERS_URL = 'https://api.tiqets.com/v2/reports/orders'
const TIQETS_REFUNDS_URL = 'https://api.tiqets.com/v2/reports/refunds'
const PAGE_SIZE = 100
const MAX_PAGES = 20
const FETCH_TIMEOUT_MS = 15_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Order-id field name is a DATA GAP — accept the first present of these (String()'d).
const ORDER_ID_KEYS = ['order_id', 'order_reference', 'id', 'reference'] as const

// Whitelist of NON-PERSONAL commercial keys copied into `raw`. Nothing outside this list
// is ever stored, so customer/buyer PII cannot leak in. campaign_name is intentionally
// included (the only *_name field we keep); product title / city are commercial, not PII.
const PII_KEYS = [
  'order_id', 'order_reference', 'id', 'reference',
  'campaign_name', 'commission_excl_vat', 'currency',
  'product_id', 'product_title', 'title', 'city',
  'order_fulfilled_at', 'click_id',
] as const

function utcDay(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

// Timeout-guarded JSON GET. Throws on non-OK so withRetry can retry transient failures.
// NEVER logs the URL/token/headers.
async function fetchJson(url: string, token: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const err = new Error(`http ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Pull the first array field found in a Tiqets report page (shape unverified).
function rowsFromPage(data: any): any[] {
  if (Array.isArray(data?.orders)) return data.orders
  if (Array.isArray(data?.refunds)) return data.refunds
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.items)) return data.items
  return []
}

// Fetch every page of a report endpoint (bounded by MAX_PAGES). Returns the collected rows
// and whether the fetch fully succeeded (false → caller degrades gracefully).
async function fetchAllPages(
  baseUrl: string,
  startDate: string,
  endDate: string,
  token: string,
  tag: string,
): Promise<{ rows: any[]; ok: boolean }> {
  const rows: any[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      page_size: String(PAGE_SIZE),
      page: String(page),
    })
    let data: any
    try {
      data = await withRetry(() => fetchJson(`${baseUrl}?${params.toString()}`, token), { retries: 1 })
    } catch (e) {
      // Log status only — never the token, URL, or headers.
      const status = (e as { status?: number })?.status ?? 'err'
      console.error(`[cron-refresh-earnings] ${tag} fetch failed — ${status}`)
      return { rows, ok: false }
    }
    const pageRows = rowsFromPage(data)
    rows.push(...pageRows)

    // Stop when this page is short, or when pagination says we've covered the total.
    const total = Number(data?.pagination?.total)
    if (pageRows.length < PAGE_SIZE) break
    if (Number.isFinite(total) && rows.length >= total) break
  }
  return { rows, ok: true }
}

function detectOrderId(row: any): string | null {
  for (const k of ORDER_ID_KEYS) {
    const v = row?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
  }
  return null
}

// Extract the well-formed apartment UUID embedded in a `bemgu-{apartmentId}` campaign tag.
// Returns the lowercased UUID or null — does NOT check existence (that's the FK-safe step).
function extractCampaignUuid(campaignName: unknown): string | null {
  if (typeof campaignName !== 'string') return null
  const m = campaignName.match(/bemgu-([0-9a-f-]{36})/i)
  if (!m) return null
  const uuid = m[1].toLowerCase()
  return UUID_RE.test(uuid) ? uuid : null
}

// campaign_name → apartment UUID, FK-safe: returns the UUID only when it is well-formed
// AND belongs to a real apartment; else null (row still stored with apartment_id null).
function resolveApartmentId(campaignName: unknown, knownAptIds: Set<string>): string | null {
  const uuid = extractCampaignUuid(campaignName)
  return uuid && knownAptIds.has(uuid) ? uuid : null
}

// Copy ONLY whitelisted commercial keys into `raw` — never customer/buyer PII.
function buildRaw(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PII_KEYS) {
    if (row?.[k] !== undefined) out[k] = row[k]
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const token = process.env.TIQETS_API_TOKEN
  if (!token) return res.status(200).json({ ok: false, reason: 'not_configured' })

  const startDate = utcDay(-14)
  const endDate = utcDay(0)

  // 1) Orders — the primary ingest. A failed final fetch aborts cleanly (never throws).
  const ordersResult = await fetchAllPages(TIQETS_ORDERS_URL, startDate, endDate, token, 'orders')
  if (!ordersResult.ok) {
    return res.status(200).json({ ok: false, reason: 'fetch_failed' })
  }
  const orderRows = ordersResult.rows

  // TEMPORARY SHAPE LOG — keys ONLY, never values. Remove after first real data is read.
  if (orderRows.length > 0) {
    console.log('[earnings:tiqets:debug]', JSON.stringify(Object.keys(orderRows[0] ?? {})))
  }

  // 2) Refunds — best-effort; continue with orders only if this fails.
  const refundsResult = await fetchAllPages(TIQETS_REFUNDS_URL, startDate, endDate, token, 'refunds')
  const refundsFetched = refundsResult.ok

  // FK-safe apartment_id resolution: collect ONLY the apartment UUIDs actually referenced
  // by this batch's campaign tags, then look up which of them are real apartments. Scoping
  // the query to seen UUIDs avoids PostgREST's 1000-row default cap on a full-table select.
  const seenUuids = [
    ...new Set(
      orderRows.map((r) => extractCampaignUuid(r?.campaign_name)).filter((u): u is string => u !== null)
    ),
  ]
  const knownAptIds = new Set<string>()
  if (seenUuids.length > 0) {
    const { data: apts, error: aErr } = await supabase.from('apartments').select('id').in('id', seenUuids)
    if (aErr) return res.status(200).json({ ok: false, reason: 'apartments_query_failed' })
    for (const a of (apts ?? []) as Array<{ id: string }>) knownAptIds.add(String(a.id).toLowerCase())
  }

  // 3) Upsert orders.
  let upserted = 0
  let skipped = 0
  for (const row of orderRows) {
    const orderId = detectOrderId(row)
    if (!orderId) { skipped++; continue }

    const campaignName = typeof row?.campaign_name === 'string' ? row.campaign_name : null
    const apartmentId = resolveApartmentId(campaignName, knownAptIds)
    const commission = Number(row?.commission_excl_vat)
    const fulfilledAt = typeof row?.order_fulfilled_at === 'string' ? row.order_fulfilled_at : null

    const { error: upErr } = await supabase
      .from('experience_orders')
      .upsert(
        {
          provider: 'tiqets',
          provider_order_id: orderId,
          apartment_id: apartmentId,
          campaign_name: campaignName,
          commission_excl_vat: Number.isFinite(commission) ? commission : null,
          currency: typeof row?.currency === 'string' ? row.currency : null,
          product_id: row?.product_id != null ? String(row.product_id) : null,
          status: 'fulfilled',
          order_fulfilled_at: fulfilledAt,
          raw: buildRaw(row),
        },
        { onConflict: 'provider,provider_order_id' }
      )
    if (upErr) console.error('[cron-refresh-earnings] order upsert failed —', upErr.message?.slice(0, 120))
    else upserted++
  }

  // 4) Apply refunds — flip a matching order row to status='refunded'. Missing = unmatched.
  // NOTE (batch-at-scale debt, shared with cron-sync-ical / cron-refresh-events): the
  // per-row upsert/update loops are sequential. Fine at current near-zero volume; pool or
  // batch these before Tiqets order volume is real.
  let refundsApplied = 0
  let refundUnmatched = 0
  if (refundsFetched) {
    // TEMPORARY SHAPE LOG — keys ONLY, never values. The refund payload shape is unverified
    // and may key its order reference differently than orders. Remove after first real data.
    if (refundsResult.rows.length > 0) {
      console.log('[earnings:tiqets:refund:debug]', JSON.stringify(Object.keys(refundsResult.rows[0] ?? {})))
    }
    for (const row of refundsResult.rows) {
      const orderId = detectOrderId(row)
      if (!orderId) { refundUnmatched++; continue }
      const { data: updated, error: rErr } = await supabase
        .from('experience_orders')
        .update({ status: 'refunded' })
        .eq('provider', 'tiqets')
        .eq('provider_order_id', orderId)
        .select('id')
      if (rErr) {
        console.error('[cron-refresh-earnings] refund update failed —', rErr.message?.slice(0, 120))
        refundUnmatched++
      } else if (updated && updated.length > 0) {
        refundsApplied++
      } else {
        refundUnmatched++
      }
    }
  }

  return res.status(200).json({
    ok: true,
    ordersFetched: orderRows.length,
    upserted,
    refundsApplied,
    refundUnmatched,
    skipped,
    refundsFetched,
  })
}
