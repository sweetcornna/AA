import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseConfiguration } from "./supabaseConfiguration";

const result = resolveSupabaseConfiguration(
  {
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    legacyAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  },
  import.meta.env.PROD,
);

export const supabaseConfigurationError = result.error;

// Untyped client for now; replace with generated Database types once hosted
// migration deployment is part of the release pipeline.
export const supabase: SupabaseClient = result.configuration
  ? createClient(result.configuration.url, result.configuration.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : new Proxy({} as SupabaseClient, {
      get() {
        throw new Error(`Supabase 配置错误：${supabaseConfigurationError}`);
      },
    });
