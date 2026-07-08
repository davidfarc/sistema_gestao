import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Callback do OAuth: troca o `code` por sessão e redireciona. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/board";

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
