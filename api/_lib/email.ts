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
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`
  const html = layout(
    `You're on the ${tierName} plan`,
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">You're now subscribed to Arrivly's <strong>${esc(tierName)}</strong> plan — your guest page stays live for every booking.</p>
     <p style="margin:0;">To upgrade, downgrade, or manage your billing details, visit your dashboard any time.</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYou're now subscribed to Arrivly's ${tierName} plan — your guest page stays live for every booking.\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `You're on the ${tierName} plan`, html, text }
}

export function subscriptionChangedEmail(
  name: string | null,
  oldTier: number,
  newTier: number,
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const oldName = TIER_NAMES[oldTier] ?? `Tier ${oldTier}`
  const newName = TIER_NAMES[newTier] ?? `Tier ${newTier}`
  const direction = newTier > oldTier ? 'upgraded' : 'changed'
  const html = layout(
    `Your plan has changed to ${newName}`,
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">Your Arrivly plan has been ${direction} from <strong>${esc(oldName)}</strong> to <strong>${esc(newName)}</strong>.</p>
     <p style="margin:0;">The change is effective immediately. Manage your subscription in your dashboard.</p>`,
    'Manage your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour Arrivly plan has been ${direction} from ${oldName} to ${newName}.\n\nManage your plan: ${APP_URL}/dashboard/billing\n\nArrivly`
  return { subject: `Your Arrivly plan has changed to ${newName}`, html, text }
}

export function subscriptionCancelledEmail(
  name: string | null,
): { subject: string; html: string; text: string } {
  const who = name?.trim() ? name.trim() : 'there'
  const html = layout(
    'Your Arrivly subscription has been cancelled',
    `<p style="margin:0 0 12px;">Hi ${esc(who)},</p>
     <p style="margin:0 0 12px;">Your Arrivly subscription has been cancelled and your guest page is no longer active.</p>
     <p style="margin:0;">You can reactivate at any time from your billing settings — your data and property setup are still there.</p>`,
    'Reactivate your plan', `${APP_URL}/dashboard/billing`,
  )
  const text = `Hi ${who},\n\nYour Arrivly subscription has been cancelled and your guest page is no longer active. You can reactivate at any time from your billing settings.\n\nReactivate: ${APP_URL}/dashboard/billing\n\nArrivly`
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

interface AdminEventInput {
  event: string
  hostName: string | null
  hostEmail: string | null
  hostId: string
  fromTier: number | null
  toTier: number
  status: string
}

export function adminSubscriptionEventEmail(
  input: AdminEventInput,
): { subject: string; html: string; text: string } {
  const { event, hostName, hostEmail, hostId, fromTier, toTier, status } = input
  const nameLabel = hostName ?? '(unnamed)'
  const emailLabel = hostEmail ?? '(no email)'
  const fromTierName = fromTier !== null ? (TIER_NAMES[fromTier] ?? `Tier ${fromTier}`) : 'none'
  const toTierName = TIER_NAMES[toTier] ?? `Tier ${toTier}`
  const html = layout(
    `Subscription event: ${event}`,
    `<table style="border-collapse:collapse;width:100%;font-size:13px;color:#444;font-family:Arial,Helvetica,sans-serif;">
       <tr><td style="padding:4px 0;color:#999;width:80px;">Event</td><td style="padding:4px 0;">${esc(event)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host</td><td style="padding:4px 0;">${esc(nameLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Email</td><td style="padding:4px 0;">${esc(emailLabel)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Host ID</td><td style="padding:4px 0;font-size:11px;font-family:monospace;">${esc(hostId)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Tier</td><td style="padding:4px 0;">${esc(fromTierName)} &rarr; ${esc(toTierName)}</td></tr>
       <tr><td style="padding:4px 0;color:#999;">Status</td><td style="padding:4px 0;">${esc(status)}</td></tr>
     </table>`,
    'Open admin', `${APP_URL}/admin`,
  )
  const text = `Arrivly subscription event: ${event}\n\nHost: ${nameLabel} <${emailLabel}>\nHost ID: ${hostId}\nTier: ${fromTierName} -> ${toTierName}\nStatus: ${status}\n\nAdmin: ${APP_URL}/admin`
  return { subject: `Arrivly: ${nameLabel} ${event}`, html, text }
}
