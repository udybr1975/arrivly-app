export const ARRIVLY_CONFIG = {
  // Pricing — change here only
  trialReminderDays: 5,
  currency: 'eur',
  currencySymbol: '€',

  // Stripe — fill after Stripe product created
  stripePriceId: '',
  stripePublishableKey: '',

  // Branding
  poweredByOnTrial: true,
  poweredByOnPaid: false,
  poweredByText: 'Powered by Arrivly',

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
  appUrl: import.meta.env.VITE_APP_URL ?? 'https://arrivly.anna-stays.fi',
  appName: 'Arrivly',

  // Maps
  defaultTravelMode: 'walking',

  // Guide
  guideRefreshDays: 30,

  // Max properties per plan (V1 = 1, expandable later)
  maxPropertiesByPlan: {
    trial: 1,
    basic: 1,
    plus: 5,
    pro: 999,
  },
} as const
