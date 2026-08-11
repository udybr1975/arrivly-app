export const ARRIVLY_CONFIG = {
  // Pricing — change here only
  currencySymbol: '€',

  // Branding
  poweredByText: 'Powered by Bemgu',

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
