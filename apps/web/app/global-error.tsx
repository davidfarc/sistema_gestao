"use client";

import { useEffect } from "react";

import { isStaleBuildError, reloadOnceForStaleBuild } from "@/lib/chunkReload";

/** Erro que derrubou a página inteira (inclusive o layout). */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (isStaleBuildError(error)) reloadOnceForStaleBuild();
    else console.error(error);
  }, [error]);
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, color: "#16252A" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Algo deu errado ao abrir esta tela</h1>
        <p style={{ color: "#5A6A6E" }}>
          Se o sistema acabou de ser atualizado, recarregar resolve. Se continuar, avise a gestão do sistema.
        </p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 14px" }}>
          Recarregar
        </button>{" "}
        <button type="button" onClick={reset} style={{ padding: "8px 14px" }}>
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
