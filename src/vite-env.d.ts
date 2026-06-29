/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_ADMIN_EMAIL: string
  readonly VITE_APP_URL: string | undefined
  readonly VITE_VAPID_PUBLIC_KEY: string
  readonly VITE_DEMO_ENABLED: string | undefined
  readonly VITE_TURNSTILE_SITE_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
