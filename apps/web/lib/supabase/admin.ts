import { createClient } from "@supabase/supabase-js";

/**
 * Client com a SECRET key (service-role) — BYPASSA RLS. SÓ NO SERVIDOR.
 * Usado no dev enquanto o login Google não está ligado e, depois, para
 * operações privilegiadas do servidor. Nunca importar em Client Component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
