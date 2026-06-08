export const TIER_COPY: Record<1 | 2 | 3 | 4, {
  name: string
  tagline: string
  bullets: string[]
  mostPopular?: boolean
}> = {
  1: {
    name: 'Starter',
    tagline: 'Your whole guest experience on one branded page.',
    bullets: [
      'Branded QR guest page',
      'AI guide & city events',
      'WiFi, check-in & rules',
      'Guest messaging + push',
    ],
  },
  2: {
    name: 'Growth',
    tagline: 'The same complete guest page, with room to grow.',
    bullets: [
      'Everything in Starter',
      'Manage a small portfolio',
    ],
    mostPopular: true,
  },
  3: {
    name: 'Portfolio',
    tagline: 'For hosts running a serious operation.',
    bullets: [
      'Everything in Growth',
      'Room to keep expanding',
    ],
  },
  4: {
    name: 'Pro',
    tagline: 'Guest experience plus a full direct-booking engine.',
    bullets: [
      'Everything in Portfolio',
      'Full booking system',
      'Availability, requests, payments',
    ],
  },
}
