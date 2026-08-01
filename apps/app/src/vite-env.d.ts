/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Build-generated marker used only for release artifact verification. */
  readonly VITE_SUPABASE_ORIGIN?: string;
  /** Legacy local-project public key; new deployments use the publishable key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly TAURI_ENV_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
