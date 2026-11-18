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

  // getClaims() renova a sessão quando preciso e valida a assinatura do token
  // localmente (chaves públicas ES256 do projeto) — sem ida ao servidor de Auth
  // a cada clique. Nunca usar getSession() para decidir acesso.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const path = request.nextUrl.pathname;
  // Públicas: login e, da central de anamneses ("Novos alunos"), a página de
  // agendamento das famílias, a política de privacidade, as consultas de
  // horários livres e o cron (que se autentica pelo CRON_SECRET).
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path === "/agendar" ||
    path === "/privacidade" ||
    // Manifesto do PWA: o navegador o busca sem os cookies de login.
    path === "/manifest.webmanifest" ||
    // Service worker das notificações: o navegador o rebusca por conta própria.
    path === "/sw.js" ||
    // Pedido aos buscadores para não varrerem o sistema: precisa responder sem login.
    path === "/robots.txt" ||
    path.startsWith("/api/anamnese/public/") ||
    // Porta interna do atendimento pelo WhatsApp: sem login, protegida por segredo próprio.
    path === "/api/whatsapp/acao" ||
    path === "/api/anamnese/cron/process";

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
