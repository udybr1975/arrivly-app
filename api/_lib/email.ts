import { Resend } from 'resend'

const FROM = 'Arrivly <hello@anna-stays.fi>'
const REPLY_TO = 'info@anna-stays.fi'
const APP_URL = process.env.VITE_APP_URL || 'https://arrivly.anna-stays.fi'

let client: Resend | null = null
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface SendEmailInput { to: string; subject: string; html: string; text: string }
export interface SendEmailResult { ok: boolean; id?: string; error?: string }

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const resend = getClient()
  if (!resend) return { ok: false, error: 'not_configured' }
  try {
    const { data, error } = await resend.emails.send({
      from: FROM, to: input.to, replyTo: REPLY_TO,
      subject: input.subject, html: input.html, text: input.text,
    })
    if (error) {
      console.error('[email] send error', String((error as { message?: string })?.message ?? error).slice(0, 120))
      return { ok: false, error: 'send_failed' }
    }
    return { ok: true, id: data?.id }
  } catch (e) {
    console.error('[email] exception', (e instanceof Error ? e.message : 'unknown').slice(0, 120))
    return { ok: false, error: 'exception' }
  }
}

function safeUrl(url: string): string {
  return url.startsWith('https://') ? url : `https://arrivly.anna-stays.fi`
}

function layout(heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string): string {
  return `<div style="margin:0;padding:0;background:#f0ede6;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
    <div style="font-size:18px;font-weight:600;letter-spacing:.02em;margin-bottom:24px;">Arrivly</div>
    <h1 style="font-size:20px;font-weight:300;margin:0 0 12px;">${esc(heading)}</h1>
    <div style="font-size:14px;line-height:1.7;color:#444;font-family:Arial,Helvetica,sans-serif;">${bodyHtml}</div>
    <a href="${safeUrl(ctaUrl)}" style="display:inline-block;margin-top:22px;background:#1c1c1a;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;padding:11px 20px;border-radius:8px;">${esc(ctaLabel)}</a>
    <div style="margin-top:28px;font-size:11px;color:#999;font-family:Arial,Helvetica,sans-serif;">Arrivly · ${APP_URL.replace('https://', '')}</div>
  </div>
</div>`
}

// ─── Shared formatting helpers ───

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const CURRENCY_SYMBOLS: Record<string, string> = { eur: '€', usd: '$', gbp: '£' }

export function formatMoney(cents: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? currency.toUpperCase()
  return `${sym}${(cents / 100).toFixed(2)}`
}

// ─── Onboarding emails ───

export function welcomeEmail(name: string | null): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const html = layout(
    'Welcome to Arrivly',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">Your account is set up and your branded guest page is ready.</p>
     <p style="margin:0;">Add your WiFi, check-in details, house rules and local picks, then share your QR code with guests.</p>`,
    'Open your dashboard', `${APP_URL}/dashboard`)
  const text = `Hi ${who},\n\nYour Arrivly account is set up and your branded guest page is ready. Add your WiFi, check-in details, house rules and local picks, then share your QR code with guests.\n\nOpen your dashboard: ${APP_URL}/dashboard\n\nArrivly`
  return { subject: 'Welcome to Arrivly', html, text }
}

export function trialReminderEmail(name: string | null, daysLeft: number): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const dayWord = daysLeft === 1 ? 'day' : 'days'
  const html = layout(
    'Your free trial is ending soon',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">Your Arrivly trial ends in <strong>${daysLeft} ${dayWord}</strong>.</p>
     <p style="margin:0;">Add a payment method to keep your guest page live for your guests. Nothing is lost if you do it now.</p>`,
    'Manage billing', `${APP_URL}/dashboard/billing`)
  const text = `Hi ${who},\n\nYour Arrivly trial ends in ${daysLeft} ${dayWord}. Add a payment method to keep your guest page live for your guests.\n\nManage billing: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `Your Arrivly trial ends in ${daysLeft} ${dayWord}`, html, text }
}

// ─── Webhook apply-time builders ───

// Tier names duplicated from src/lib/tierCopy.ts — same cross-boundary pattern as EXTRAS_CATEGORIES.
const TIER_NAMES: Record<number, string> = {
  1: 'Starter',
  2: 'Growth',
  3: 'Portfolio',
  4: 'Pro',
}

export function subscriptionStartedEmail(
  name: string | null,
  tier: number,
  opts: { priceCents: number; currency: string; nextPaymentIso: string },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`
  const price = formatMoney(opts.priceCents, opts.currency)
  const nextDate = formatDateLong(opts.nextPaymentIso)
  const html = layout(
    `You're on the ${tierName} plan`,
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;"><strong>${esc(tierName)}</strong> — ${esc(price)}/month. No charge during your trial; your first payment of <strong>${esc(price)}</strong> will be on ${esc(nextDate)}.</p>
     <p style="margin:0;">To upgrade, downgrade, or manage your billing details, visit your dashboard any time.</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\n${tierName} — ${price}/month. No charge during your trial; your first payment of ${price} will be on ${nextDate}.\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `You're on the ${tierName} plan`, html, text }
}

export function subscriptionChangedEmail(
  name: string | null,
  oldTier: number,
  newTier: number,
  opts: { priceCents: number; currency: string; renewalIso: string; amountChargedCents?: number | null },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const oldName = TIER_NAMES[oldTier] ?? `Tier ${oldTier}`
  const newName = TIER_NAMES[newTier] ?? `Tier ${newTier}`
  const price = formatMoney(opts.priceCents, opts.currency)
  const renewalDate = formatDateLong(opts.renewalIso)
  let bodyHtml: string
  let bodyText: string
  if (opts.amountChargedCents != null) {
    const charged = formatMoney(opts.amountChargedCents, opts.currency)
    bodyHtml = `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0;">Your Arrivly plan has been upgraded from <strong>${esc(oldName)}</strong> to <strong>${esc(newName)}</strong>, effective now. We charged <strong>${esc(charged)}</strong> today for the rest of this billing period. Your plan is ${esc(price)}/month, renewing ${esc(renewalDate)}.</p>`
    bodyText = `Hi ${who},\n\nYour Arrivly plan has been upgraded from ${oldName} to ${newName}, effective now. We charged ${charged} today for the rest of this billing period. Your plan is ${price}/month, renewing ${renewalDate}.`
  } else {
    bodyHtml = `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0;">Your Arrivly plan has been changed from <strong>${esc(oldName)}</strong> to <strong>${esc(newName)}</strong>. Your plan is ${esc(price)}/month from ${esc(renewalDate)}.</p>`
    bodyText = `Hi ${who},\n\nYour Arrivly plan has been changed from ${oldName} to ${newName}. Your plan is ${price}/month from ${renewalDate}.`
  }
  const html = layout(`Your plan has changed to ${newName}`, bodyHtml, 'Manage your plan', `${APP_URL}/dashboard/billing`)
  const text = `${bodyText}\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `Your Arrivly plan has changed to ${newName}`, html, text }
}

export function subscriptionCancelledEmail(
  name: string | null,
  opts?: { endedIso?: string | null },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const endedNoteHtml = opts?.endedIso
    ? `<p style="margin:0 0 12px;">Your subscription ended on <strong>${esc(formatDateLong(opts.endedIso))}</strong>.</p>`
    : ''
  const endedNoteText = opts?.endedIso ? `Your subscription ended on ${formatDateLong(opts.endedIso)}.\n\n` : ''
  const html = layout(
    'Your Arrivly subscription has been cancelled',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     ${endedNoteHtml}<p style="margin:0 0 12px;">Your Arrivly subscription has been cancelled and your guest page is no longer active.</p>
     <p style="margin:0;">You can reactivate at any time from your billing settings — your data and property setup are still there.</p>`,
    'Reactivate your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\n${endedNoteText}Your Arrivly subscription has been cancelled and your guest page is no longer active. You can reactivate at any time from your billing settings.\n\nReactivate: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: 'Your Arrivly subscription has been cancelled', html, text }
}

export function subscriptionPastDueEmail(
  name: string | null,
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const html = layout(
    'Action needed: payment issue',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">We couldn't charge your payment method. Your Arrivly guest page is still live for now — please update your card soon to avoid any interruption.</p>
     <p style="margin:0;">Visit your billing settings to update your payment method.</p>`,
    'Update payment method', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nWe couldn't charge your payment method. Your Arrivly guest page is still live for now — please update your card soon to avoid any interruption.\n\nUpdate payment method: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: 'Action needed: payment issue with your Arrivly subscription', html, text }
}

// ─── Admin webhook apply-time email ───

interface AdminEventInput {
  event: string
  hostName: string | null
  hostEmail: string | null
  hostId: string
  fromTier: number | null
  toTier: number
  status: string
  priceCents?: number | null
  currency?: string | null
  amountChargedCents?: number | null
  renewalIso?: string | null
}

export function adminSubscriptionEventEmail(
  input: AdminEventInput,
): { subject: string; html: string; text: string } {
  const { event, hostName, hostEmail, hostId, fromTier, toTier, status,
          priceCents, currency, amountChargedCents, renewalIso } = input
  const nameLabel = hostName ?? '(unnamed)'
  const emailLabel = hostEmail ?? '(no email)'
  const fromTierName = fromTier !== null ? (TIER_NAMES[fromTier] ?? `Tier ${fromTier}`) : 'none'
  const toTierName = TIER_NAMES[toTier] ?? `Tier ${toTier}`
  const priceRow = priceCents != null && currency
    ? `<tr><td style="padding:4px 0;color:#999;">New price</td><td style="padding:4px 0;">${esc(formatMoney(priceCents, currency))}/month</td></tr>`
    : ''
  const chargedRow = amountChargedCents != null && currency
    ? `<tr><td style="padding:4px 0;color:#999;">Amount charged</td><td style="padding:4px 0;">${esc(formatMoney(amountChargedCents, currency))}</td></tr>`
    : ''
  const renewalRow = renewalIso
    ? `<tr><td style="padding:4px 0;color:#999;">Renewal</td><td style="padding:4px 0;">${esc(formatDateLong(renewalIso))}</td></tr>`
    : ''
  const html = layout(
    `Subscription event: ${event}`,
    `<table style="border-collapse:collapse;width:100%;font-size:13px;color:#444;font-family:Arial,Helvetica,sans-serif;">
       <tr><td style="padding:4px 0;color:#999;width:90px;">Event</td><td style="padding:4px 0;">${esc(event)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host</td><td style="padding:4px 0;">${esc(nameLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Email</td><td style="padding:4px 0;">${esc(emailLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host ID</td><td style="padding:4px 0;font-size:11px;font-family:monospace;">${esc(hostId)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Tier</td><td style="padding:4px 0;">${esc(fromTierName)} &rarr; ${esc(toTierName)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Status</td><td style="padding:4px 0;">${esc(status)}</td></tr>
       ${priceRow}${chargedRow}${renewalRow}
     </table>`,
    'Open admin', `${APP_URL}/admin`,
  )
  const priceText = priceCents != null && currency ? `New price: ${formatMoney(priceCents, currency)}/month\n` : ''
  const chargedText = amountChargedCents != null && currency ? `Amount charged: ${formatMoney(amountChargedCents, currency)}\n` : ''
  const renewalText = renewalIso ? `Renewal: ${formatDateLong(renewalIso)}\n` : ''
  const text = `Arrivly subscription event: ${event}\n\nHost: ${nameLabel} <${emailLabel}>\nHost ID: ${hostId}\nTier: ${fromTierName} -> ${toTierName}\nStatus: ${status}\n${priceText}${chargedText}${renewalText}\nAdmin: ${APP_URL}/admin`
  return { subject: `Arrivly: ${nameLabel} ${event}`, html, text }
}

// ─── Request-time builders (sent immediately on host action; distinct from webhook apply-time) ───

export function subscriptionScheduledChangeEmail(
  name: string | null,
  fromTier: number,
  toTier: number,
  effectiveAtIso: string,
  opts: { priceCents: number; currency: string; propertyCount?: number; newCap?: number | null },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const fromName = TIER_NAMES[fromTier] ?? `Tier ${fromTier}`
  const toName = TIER_NAMES[toTier] ?? `Tier ${toTier}`
  const date = formatDateLong(effectiveAtIso)
  const price = formatMoney(opts.priceCents, opts.currency)
  const overCap = opts.newCap != null && opts.propertyCount != null && opts.propertyCount > opts.newCap
  const capNoteHtml = overCap
    ? ` ${esc(toName)} covers up to ${opts.newCap} ${opts.newCap === 1 ? 'property' : 'properties'}. You have ${opts.propertyCount}, so remove ${opts.propertyCount! - opts.newCap!} before ${esc(date)} to stay within ${esc(toName)}.`
    : ''
  const capNoteText = overCap
    ? ` ${toName} covers up to ${opts.newCap} properties. You have ${opts.propertyCount}, so remove ${opts.propertyCount! - opts.newCap!} before ${date} to stay within ${toName}.`
    : ''
  const html = layout(
    'Your plan change is scheduled',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0;">Your plan will change to <strong>${esc(toName)}</strong> (${esc(price)}/month) on <strong>${esc(date)}</strong>. You stay on ${esc(fromName)} until then — no charge now.${capNoteHtml}</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour plan will change to ${toName} (${price}/month) on ${date}. You stay on ${fromName} until then — no charge now.${capNoteText}\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `Your plan change to ${toName} is scheduled`, html, text }
}

export function subscriptionScheduledCancelEmail(
  name: string | null,
  effectiveAtIso: string | null,
  opts?: { alsoCancelledScheduledChange?: boolean },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const dateStr = effectiveAtIso ? formatDateLong(effectiveAtIso) : 'the end of your current period'
  const noChargeHtml = effectiveAtIso
    ? `<p style="margin:0 0 12px;">No further charges after ${esc(dateStr)}.</p>`
    : ''
  const noChargeText = effectiveAtIso ? `No further charges after ${dateStr}.\n\n` : ''
  const alsoHtml = opts?.alsoCancelledScheduledChange
    ? `<p style="margin:0 0 12px;">Your previously scheduled plan change has also been cancelled.</p>`
    : ''
  const alsoText = opts?.alsoCancelledScheduledChange
    ? 'Your previously scheduled plan change has also been cancelled.\n\n'
    : ''
  const html = layout(
    'Your cancellation is scheduled',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">Your Arrivly subscription will end on <strong>${esc(dateStr)}</strong>. Your guest pages stay live until then. You can resume your subscription anytime from your dashboard.</p>
     ${alsoHtml}${noChargeHtml}`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour Arrivly subscription will end on ${dateStr}. Your guest pages stay live until then. You can resume your subscription anytime from your dashboard.\n\n${alsoText}${noChargeText}Manage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: 'Your Arrivly cancellation is scheduled', html, text }
}

export function subscriptionChangeRevertedEmail(
  name: string | null,
  currentTier: number,
  opts: { priceCents: number; currency: string; renewalIso: string },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const currentName = TIER_NAMES[currentTier] ?? `Tier ${currentTier}`
  const price = formatMoney(opts.priceCents, opts.currency)
  const renewalDate = formatDateLong(opts.renewalIso)
  const html = layout(
    'Your scheduled change was cancelled',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0;">Your scheduled plan change has been cancelled. You'll stay on <strong>${esc(currentName)}</strong> (${esc(price)}/month), renewing ${esc(renewalDate)}. Nothing changes.</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour scheduled plan change has been cancelled. You'll stay on ${currentName} (${price}/month), renewing ${renewalDate}. Nothing changes.\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: 'Your scheduled Arrivly plan change was cancelled', html, text }
}

export function subscriptionResumedEmail(
  name: string | null,
  opts?: { priceCents?: number | null; currency?: string | null; renewalIso?: string | null },
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const hasPricing = opts?.priceCents != null && opts?.currency
  const priceHtml = hasPricing
    ? ` renews at <strong>${esc(formatMoney(opts!.priceCents!, opts!.currency!))}/month</strong>${opts?.renewalIso ? ` on ${esc(formatDateLong(opts.renewalIso))}` : ''}`
    : ''
  const priceText = hasPricing
    ? ` renews at ${formatMoney(opts!.priceCents!, opts!.currency!)}/month${opts?.renewalIso ? ` on ${formatDateLong(opts.renewalIso)}` : ''}`
    : ''
  const html = layout(
    'Your subscription is active again',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0;">Your cancellation has been undone. Your Arrivly subscription${priceHtml}.</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour cancellation has been undone. Your Arrivly subscription${priceText}.\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: 'Your Arrivly subscription is active again', html, text }
}

// ─── Admin request-time email ───

interface AdminRequestInput {
  event: 'scheduled_downgrade' | 'scheduled_cancel' | 'reverted' | 'resumed'
  hostName: string | null
  hostEmail: string | null
  hostId: string
  fromTier: number | null
  toTier: number | null
  effectiveAt?: string | null
  priceCents?: number | null
  currency?: string | null
}

const HUMAN_EVENT: Record<string, string> = {
  scheduled_downgrade: 'scheduled a downgrade',
  scheduled_cancel: 'scheduled a cancellation',
  reverted: 'undid a scheduled change',
  resumed: 'resumed their subscription',
}

export function adminSubscriptionRequestEmail(
  input: AdminRequestInput,
): { subject: string; html: string; text: string } {
  const { event, hostName, hostEmail, hostId, fromTier, toTier, effectiveAt, priceCents, currency } = input
  const nameLabel = hostName ?? '(unnamed)'
  const emailLabel = hostEmail ?? '(no email)'
  const humanEvent = HUMAN_EVENT[event] ?? event
  const fromTierName = fromTier !== null ? (TIER_NAMES[fromTier] ?? `Tier ${fromTier}`) : 'n/a'
  const toTierName = toTier !== null ? (TIER_NAMES[toTier] ?? `Tier ${toTier}`) : 'n/a'
  const effectiveLabel = effectiveAt ? formatDateLong(effectiveAt) : 'immediate'
  const priceRow = priceCents != null && currency
    ? `<tr><td style="padding:4px 0;color:#999;">New price</td><td style="padding:4px 0;">${esc(formatMoney(priceCents, currency))}/month</td></tr>`
    : ''
  const priceText = priceCents != null && currency ? `New price: ${formatMoney(priceCents, currency)}/month\n` : ''
  const html = layout(
    `Request: ${humanEvent}`,
    `<table style="border-collapse:collapse;width:100%;font-size:13px;color:#444;font-family:Arial,Helvetica,sans-serif;">
       <tr><td style="padding:4px 0;color:#999;width:90px;">Event</td><td style="padding:4px 0;">${esc(humanEvent)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host</td><td style="padding:4px 0;">${esc(nameLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Email</td><td style="padding:4px 0;">${esc(emailLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host ID</td><td style="padding:4px 0;font-size:11px;font-family:monospace;">${esc(hostId)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Tier</td><td style="padding:4px 0;">${esc(fromTierName)} &rarr; ${esc(toTierName)}</td></tr>
       ${priceRow}
       <tr><td style="padding:4px 0;color:#999;">Timing</td><td style="padding:4px 0;">Requested</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Effective</td><td style="padding:4px 0;">${esc(effectiveLabel)}</td></tr>
     </table>`,
    'Open admin', `${APP_URL}/admin`,
  )
  const text = `Arrivly request: ${nameLabel} ${humanEvent}\n\nHost: ${nameLabel} <${emailLabel}>\nHost ID: ${hostId}\nTier: ${fromTierName} -> ${toTierName}\n${priceText}Timing: Requested\nEffective: ${effectiveLabel}\n\nAdmin: ${APP_URL}/admin`
  return { subject: `Arrivly: ${nameLabel} ${humanEvent}`, html, text }
}
