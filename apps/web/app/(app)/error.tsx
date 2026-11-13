"use client";

import { useEffect } from "react";

import { isStaleBuildError, reloadOnceForStaleBuild } from "@/lib/chunkReload";

/** Erro dentro de uma tela do sistema: o menu continua de pé. */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (isStaleBuildError(error)) reloadOnceForStaleBuild();
    else console.error(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-xl">Algo deu errado ao abrir esta tela</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Se o sistema acabou de ser atualizado, recarregar resolve. Se continuar, avise a gestão do sistema.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high"
        >
          Recarregar
        </button>
        <button
          type="button"
          onClick={reset}
          className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700"
        >
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
