"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mostra o motivo real vindo do /auth/callback (?error=...).
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setError(decodeURIComponent(e));
  }, []);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Repassa o destino que o middleware guardou, para cair no lugar clicado
    // (um formulário de novo card, um card específico) e não na home.
    const next = new URLSearchParams(window.location.search).get("next");
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // Sucesso → o browser é redirecionado para o Google.
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Editora Ecco Prime
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Gestão Editorial</h1>
        <p className="mt-2 text-sm text-neutral-500">Entre para acessar o sistema.</p>
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={loading}
        className="flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-60"
      >
        {loading ? "Redirecionando…" : "Entrar com Google"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
