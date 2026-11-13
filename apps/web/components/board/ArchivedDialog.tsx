"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadArchivedCards, setCardArchived } from "@/lib/board/actions";
import type { ArchivedCard } from "@/lib/board/types";

/** Cards arquivados do pipeline: ver, abrir e reativar. */
export function ArchivedDialog({
  boardId,
  boardName,
  onClose,
  onRestored,
}: {
  boardId: string;
  boardName: string;
  onClose: () => void;
  /** Um card voltou ao quadro: quem hospeda recarrega a lista de cards. */
  onRestored: () => void;
}) {
  const [cards, setCards] = useState<ArchivedCard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadArchivedCards(boardId)
      .then((list) => active && setCards(list))
      .catch(() => active && setCards([]));
    return () => {
      active = false;
    };
  }, [boardId]);

  async function restore(card: ArchivedCard) {
    setBusy(card.id);
    setError(null);
    try {
      const res = await setCardArchived(card.id, false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCards((prev) => (prev ?? []).filter((c) => c.id !== card.id));
      onRestored();
    } catch {
      setError("Não foi possível reativar. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-5">
          <div>
            <h2 className="text-lg font-semibold text-neutral-800">Cards arquivados</h2>
            <p className="mt-1 text-sm text-neutral-600">
              {boardName}. Arquivar não apaga: comentários, checklists e histórico ficam guardados.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Fechar
          </button>
        </div>

        <div className="p-5">
          {cards === null ? (
            <div className="grid gap-2" aria-hidden="true">
              <div className="h-14 animate-pulse rounded-lg bg-neutral-100" />
              <div className="h-14 animate-pulse rounded-lg bg-neutral-100" />
            </div>
          ) : cards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-600">
              Nenhum card arquivado neste pipeline. Para arquivar, abra o card e use “Arquivar
              card”, perto dos comentários.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
              {cards.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      <span className="text-neutral-600">#{c.number}</span> {c.title}
                    </p>
                    <p className="text-xs text-neutral-600">
                      Estava em “{c.stageName || "?"}” · arquivado em{" "}
                      {new Date(c.archivedAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <Link
                    href={`/card/${c.id}`}
                    className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-primary hover:underline"
                  >
                    Abrir
                  </Link>
                  <button
                    type="button"
                    onClick={() => restore(c)}
                    disabled={busy === c.id}
                    className="min-h-9 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
                  >
                    {busy === c.id ? "Reativando…" : "Reativar"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
