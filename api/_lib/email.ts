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
