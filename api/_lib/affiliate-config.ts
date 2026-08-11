// Non-secret affiliate CONSTANTS for the Phase I experiences pipeline.
//
// Everything here is a PUBLIC identifier (partner / channel IDs) — safe to live in
// the repo and in logs. API keys/tokens are NEVER here: they live in server-side
// Vercel env vars (VIATOR_API_KEY, TIQETS_API_TOKEN) read directly from process.env.
//
// This file exists separately from src/config.ts because src/config.ts is
// import.meta.env-based (Vite) and cannot be imported from api/ (native Node ESM).

// Bemgu's OWN affiliate identifiers — used for guests of tier 1–2 hosts (Bemgu earns
// the commission) and as the fallback whenever a tier 3+ host has not connected theirs.
export const BEMGU_GYG_PARTNER_ID = 'VMY9NWZ'
export const BEMGU_VIATOR_PID = 'P00310630'
export const VIATOR_MCID = '42383' // Viator channel id for the link tool — constant
export const BEMGU_TIQETS_PARTNER_ID = 'bemgu-188668'

// Hosts at tier >= this use their OWN GetYourGuide and Tiqets partner IDs (those providers
// pay the host directly); lower tiers keep Bemgu's IDs (Bemgu earns). See "c-full" in
// CLAUDE.md Phase I.
// VIATOR IS THE EXCEPTION AND IS ALWAYS BEMGU-ATTRIBUTED, at every tier: a host PID may not
// ride on links served from bemgu.app (written ruling, 4 Aug 2026 — VPP General Terms
// "Partner Site" + Service Terms B-1.5). `resolvePartnerId` short-circuits Viator ABOVE this
// gate, so the gate governs gyg/tiqets only. See PERMANENT PROVIDER CONSTRAINTS in CLAUDE.md.
export const EXPERIENCES_TIER_GATE = 3
