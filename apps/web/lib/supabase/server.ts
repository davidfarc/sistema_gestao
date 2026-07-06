import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Client do Supabase para código de servidor (RSC, Route Handlers, Server
 * Actions). Lê/escreve a sessão nos cookies. Em RSC a escrita de cookie falha
 * silenciosamente — o middleware é quem renova a sessão.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Chamado de um Server Component — ignorar; o middleware renova.
          }
        },
      },
    },
  );
}
