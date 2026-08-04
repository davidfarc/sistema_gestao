import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Renova a sessão a cada request e protege rotas: sem usuário → redireciona
 * para /login (exceto rotas públicas /login e /auth/*).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANTE: getUser() valida o token no servidor (não confiar em getSession).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isPublic) {
    // Guarda o destino para devolver a pessoa a ele depois de entrar. Sem isso,
    // um link compartilhado (ex.: o formulário de novo card no portal de
    // atalhos) joga quem ainda não logou na home e perde a intenção do clique.
    const url = request.nextUrl.clone();
    const destino = path + request.nextUrl.search;
    url.pathname = "/login";
    url.search = destino === "/" ? "" : `?next=${encodeURIComponent(destino)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
