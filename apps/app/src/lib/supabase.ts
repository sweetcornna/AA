import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in apps/app/.env",
  );
}

// Untyped client for now; replace with `supabase gen types typescript` output
// and `createClient<Database>` once the schema is applied locally.
export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
