import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Só aceita destino interno. `next` vem da URL, então é entrada não confiável:
 * sem esta checagem, "//evil.com" ou "https://evil.com" viraria um redirect
 * aberto — um phishing que empresta a credibilidade do nosso domínio.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/board";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/board";
}

/** Callback do OAuth: troca o `code` por sessão e redireciona. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Google/Supabase devolveram um erro no lugar do code?
  const oauthError = searchParams.get("error_description") || searchParams.get("error");
  if (oauthError) {
    console.error("auth callback oauth error:", oauthError);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("auth callback exchange error:", error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("exchange: " + error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=no_code`);
}
