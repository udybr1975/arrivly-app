export const ARRIVLY_CONFIG = {
  // Pricing — change here only
  currencySymbol: '€',

  // Branding
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
} as const
