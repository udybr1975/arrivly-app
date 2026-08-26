export const ARRIVLY_CONFIG = {
  // Pricing — change here only
  currencySymbol: '€',

  // Branding
  poweredByText: 'Powered by Bemgu',
  // The PLATFORM's public brand — deliberately NOT called brandName, which everywhere
  // else in the guest UI means the HOST's brand. Used where a disclosure has to name
  // the platform itself as a party (e.g. the commission disclosure in ExperiencesSheet).
  platformName: 'Bemgu',

  // Colour presets for host branding
  colourPresets: [
    { name: 'Charcoal', hex: '#1c1c1a' },
    { name: 'Forest', hex: '#1a3a0a' },
    { name: 'Navy', hex: '#0c3547' },
    { name: 'Wine', hex: '#5a1a2a' },
    { name: 'Amber', hex: '#7a5c00' },
    { name: 'Indigo', hex: '#2a2a5a' },
  ],

  // Admin
  adminEmail: 'udy.bar.yosef@gmail.com',

  // App
  appUrl: import.meta.env.VITE_APP_URL ?? 'https://bemgu.app',

  // THE PUBLIC PEEK — the landing page's scriptless demo guest page. ONE constant, so the QR
  // and the "open it here" link can never drift apart (they encode the same URL, and a QR
  // that goes somewhere else than the link beside it is undebuggable from a screenshot).
  // The apartment carries `apartments.is_public_demo` server-side — THAT flag, not this
  // value, is what makes the page behave as a demo. Changing the id here without moving the
  // flag gives you an ordinary guest page with a demo banner and no banner at all.
  // The token is a published booking reference and is meant to be public.
  publicDemo: {
    apartmentId: 'd9614d11-d573-4ff0-961a-54c5ea37c2bd',
    token: 'ARR-EVT777',
  },

  // Experiences marketplace (Phase I). `experiencesTierGate` MIRRORS the server-side
  // EXPERIENCES_TIER_GATE in api/_lib/affiliate-config.ts — hosts at/above this tier
  // connect their OWN GetYourGuide and Tiqets partner IDs and keep those commissions;
  // below it links carry Bemgu's IDs and the Earnings tease shows an upgrade path.
  // VIATOR IS ALWAYS BEMGU-ATTRIBUTED at every tier — a host PID may not ride on links
  // served from bemgu.app (written ruling, 4 Aug 2026; see PERMANENT PROVIDER
  // CONSTRAINTS in CLAUDE.md), so the gate does not apply to it. `experienceEstimate`
  // drives the tease's illustrative figures ONLY — labelled assumptions, never real earnings.
  experiencesTierGate: 3,
  experienceEstimate: {
    conversionRate: 0.045, // ~4–5% of taps become a booking
    avgBookingValueEuros: 90, // typical tour/ticket order value
    commissionRate: 0.08, // ~8% affiliate commission
  },
} as const
