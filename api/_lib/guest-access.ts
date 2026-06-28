import type { SupabaseClient } from '@supabase/supabase-js'

export type GuestTier = 'verified' | 'public' | 'owner'
export interface GuestAccess { tier: GuestTier; guestName: string | null; bookingId: string | null; checkIn: string | null }

export function authorizePreview(
  apartmentHostId: string,
  userId: string,
  userEmail: string | null | undefined,
  adminEmail: string
): { ok: boolean; isOwner: boolean; isAdmin: boolean } {
  const isOwner = userId === apartmentHostId
  const isAdmin = userEmail === adminEmail
  return { ok: isOwner || isAdmin, isOwner, isAdmin }
}

export interface ApartmentCtx {
  id: string
  name: string
  city: string
  country: string | null
  neighborhood: string | null
  street: string | null
  street_number: string | null
}

// Helsinki "today" (YYYY-MM-DD) — matches GuestPage's booking gating timezone.
function helsinkiToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Helsinki' }).split(' ')[0]
}

// Tier 1: a valid token for an in-dates confirmed/completed booking = verified.
// Tier 2 will add branches here (prospect, paid/pending, email+reference) WITHOUT
// changing guest-chat.ts or ChatBot.tsx.
export async function resolveGuestAccess(
  db: SupabaseClient,
  apartmentId: string,
  token: string | null
): Promise<GuestAccess> {
  const PUBLIC: GuestAccess = { tier: 'public', guestName: null, bookingId: null, checkIn: null }
  if (!token) return PUBLIC
  const { data: booking } = await db
    .from('bookings')
    .select('id, check_in, check_out, guest_id, status')
    .eq('reference_number', token)
    .eq('apartment_id', apartmentId)
    .in('status', ['confirmed', 'completed'])
    .limit(1)
    .maybeSingle()
  if (!booking) return PUBLIC
  const today = helsinkiToday()
  if (today < booking.check_in || today > booking.check_out) return PUBLIC
  let guestName: string | null = null
  if (booking.guest_id) {
    const { data: g } = await db.from('guests').select('first_name').eq('id', booking.guest_id).maybeSingle()
    guestName = g?.first_name ?? null
  }
  return { tier: 'verified', guestName, bookingId: booking.id, checkIn: booking.check_in }
}

export interface MessagingAccess { allowed: boolean; bookingId: string | null; guestName: string | null }

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// Wider window than resolveGuestAccess: messaging is allowed from when the booking
// exists (no check-in lower bound, so pre-arrival questions work) until the day
// AFTER check-out.
export async function resolveMessagingAccess(
  db: SupabaseClient,
  apartmentId: string,
  token: string | null
): Promise<MessagingAccess> {
  const none: MessagingAccess = { allowed: false, bookingId: null, guestName: null }
  if (!token) return none
  const { data: booking } = await db
    .from('bookings')
    .select('id, check_out, guest_id, status')
    .eq('reference_number', token)
    .eq('apartment_id', apartmentId)
    .in('status', ['confirmed', 'completed'])
    .limit(1)
    .maybeSingle()
  if (!booking) return none
  const today = helsinkiToday()
  if (today > addDaysISO(booking.check_out, 1)) return none
  let guestName: string | null = null
  if (booking.guest_id) {
    const { data: g } = await db.from('guests').select('first_name').eq('id', booking.guest_id).maybeSingle()
    guestName = g?.first_name ?? null
  }
  return { allowed: true, bookingId: booking.id, guestName }
}

// Builds the system instruction server-side. Private apartment_details rows are
// included ONLY for the verified tier — a public caller never receives them.
export async function buildGuestSystemInstruction(
  db: SupabaseClient,
  apt: ApartmentCtx,
  access: GuestAccess,
  brandName: string
): Promise<string> {
  const { data: detailRows } = await db
    .from('apartment_details')
    .select('category, content, is_private')
    .eq('apartment_id', apt.id)
  const details = (detailRows ?? []).filter(d => access.tier !== 'public' || !d.is_private)

  const { data: picks } = await db
    .from('host_picks')
    .select('name, category, address, note')
    .eq('apartment_id', apt.id)
    .order('display_order')

  const { data: guide } = await db
    .from('guide_recommendations')
    .select('categories')
    .eq('apartment_id', apt.id)
    .maybeSingle()

  const detailsBlock = details.length
    ? details.map(d => `[${d.category}]${d.is_private && access.tier === 'public' ? ' (private)' : ''} ${d.content}`).join('\n')
    : 'No apartment details on file yet.'

  const picksBlock = (picks ?? []).length
    ? (picks ?? []).map(p => `- ${p.name} (${p.category})${p.address ? `, ${p.address}` : ''}${p.note ? ` — ${p.note}` : ''}`).join('\n')
    : 'No host recommendations yet.'

  let guideBlock = 'No neighbourhood guide yet.'
  const cats = guide?.categories as Record<string, Array<{ name: string; address?: string; description?: string }>> | undefined
  if (cats && Object.keys(cats).length) {
    guideBlock = Object.entries(cats)
      .map(([cat, items]) =>
        `${cat}:\n` +
        (Array.isArray(items)
          ? items.map(i => `  - ${i.name}${i.address ? `, ${i.address}` : ''}${i.description ? ` — ${i.description}` : ''}`).join('\n')
          : ''))
      .join('\n')
  }

  const where = [apt.neighborhood, apt.city, apt.country].filter(Boolean).join(', ')
  const streetLine = [apt.street, apt.street_number].filter(Boolean).join(' ')
  const fullAddress = [streetLine, apt.neighborhood, apt.city, apt.country].filter(Boolean).join(', ')
  const addressBlock = access.tier !== 'public' && streetLine
    ? `ADDRESS: ${fullAddress}`
    : ''
  const guestLine = access.tier !== 'public' && access.guestName
    ? `The guest's name is ${access.guestName}. You may greet them by name on your first reply.`
    : ''
  const privacyRule = access.tier !== 'public'
    ? `This is a VERIFIED guest currently staying here. You may share every apartment detail, including check-in instructions, door codes, Wi-Fi, and the address.`
    : `This is a PUBLIC visitor, not a verified guest. You only have public information. If asked for private details (door code, Wi-Fi password, exact address, check-in instructions), politely explain those are shared with confirmed guests once their stay is verified, and offer to help with anything else. Never guess or invent private details.`

  return [
    `You are the friendly in-app assistant for "${brandName}", helping the guest of ${apt.name} in ${where}.`,
    guestLine,
    ``,
    `ACCESS:`,
    privacyRule,
    ``,
    `GROUNDING:`,
    `- For anything about THIS apartment (Wi-Fi, check-in, rules, amenities, address), use ONLY the APARTMENT DATA below. If something isn't there, say you don't have it on file and suggest messaging the host — never invent it.`,
    `- For general questions about the area (restaurants, cafes, transport, sights, opening hours, current events), you may use Google Search, and you can draw on the HOST RECOMMENDATIONS and NEIGHBOURHOOD GUIDE below. Prefer the host's own picks when they fit.`,
    ``,
    `STYLE:`,
    `- Warm, concise, conversational. Never use markdown bold or double asterisks — plain text only. Keep replies short unless asked for more.`,
    ``,
    `APARTMENT DATA:`,
    addressBlock,
    detailsBlock,
    ``,
    `HOST RECOMMENDATIONS:`,
    picksBlock,
    ``,
    `NEIGHBOURHOOD GUIDE:`,
    guideBlock,
  ].join('\n')
}
