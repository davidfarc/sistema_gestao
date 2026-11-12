"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import {
  loadTransferPlan,
  loadTransferTargets,
  transferCard,
  type TransferPlan,
  type TransferTarget,
} from "@/lib/board/transfer";
import type { FieldType } from "@/lib/board/types";

export interface TransferResult {
  boardId: string;
  boardName: string;
  number: number;
}

function compatible(a: FieldType, b: FieldType): boolean {
  if (a === b) return true;
  const text: FieldType[] = ["text", "long_text"];
  const choice: FieldType[] = ["select", "status"];
  return (text.includes(a) && text.includes(b)) || (choice.includes(a) && choice.includes(b));
}

/**
 * "Enviar para outro pipeline", em dois passos: escolher o destino e conciliar
 * os campos (para onde vai cada valor do pipeline de origem). O que não tiver
 * correspondente não se perde: vira um comentário no card.
 */
export function TransferDialog({
  cardId,
  cardLabel,
  onClose,
  onTransferred,
}: {
  cardId: string;
  cardLabel: string;
  onClose: () => void;
  onTransferred: (result: TransferResult) => void;
}) {
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadTransferTargets(cardId)
      .then((t) => active && setTargets(t))
      .catch(() => active && setTargets([]));
    return () => {
      active = false;
    };
  }, [cardId]);

  // Escolhido o destino, busca os campos dos dois lados e a sugestão de pares.
  useEffect(() => {
    setPlan(null);
    setError(null);
    if (!targetId) return;
    let active = true;
    loadTransferPlan(cardId, targetId)
      .then((p) => {
        if (!active) return;
        setPlan(p);
        setMap(Object.fromEntries(p.source.map((f) => [f.id, f.suggestedTo ?? ""])));
      })
      .catch(() => active && setError("Não foi possível carregar os campos deste pipeline."));
    return () => {
      active = false;
    };
  }, [cardId, targetId]);

  async function send() {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await transferCard(
        cardId,
        targetId,
        plan.source.map((f) => ({ from: f.id, to: map[f.id] || null })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onTransferred({ boardId: res.boardId, boardName: res.boardName, number: res.number });
    } catch {
      setError("Não foi possível enviar o card. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  // Um campo de destino recebe no máximo um valor.
  const usedBy = (targetFieldId: string, exceptSource: string) =>
    Object.entries(map).some(([from, to]) => to === targetFieldId && from !== exceptSource);
  const semPar = plan ? plan.source.filter((f) => !map[f.id]).length : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-neutral-200 p-5">
          <h2 className="text-lg font-semibold text-neutral-800">Enviar para outro pipeline</h2>
          <p className="mt-1 text-sm text-neutral-600">{cardLabel}</p>
        </div>

        <div className="grid gap-5 p-5">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-neutral-700">Pipeline de destino</span>
            {targets === null ? (
              <div className="h-10 animate-pulse rounded-lg bg-neutral-100" />
            ) : targets.length === 0 ? (
              <p className="text-sm text-neutral-600">
                Não há outro pipeline para o qual você possa enviar cards.
              </p>
            ) : (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
              >
                <option value="">Escolha…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          {targetId && !plan && !error && (
            <div className="h-24 animate-pulse rounded-lg bg-neutral-100" aria-hidden="true" />
          )}

          {plan && (
            <>
              <div className="grid gap-2">
                <p className="text-sm font-medium text-neutral-700">Conciliar campos</p>
                {plan.source.length === 0 ? (
                  <p className="text-sm text-neutral-600">
                    Este card não tem campos próprios do pipeline atual para levar.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {plan.source.map((f) => {
                      const options = plan.target.filter((t) => compatible(f.type, t.type));
                      return (
                        <li
                          key={f.id}
                          className="grid items-center gap-2 rounded-lg border border-neutral-200 p-3 sm:grid-cols-[1fr_auto_1fr]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-800">{f.name}</p>
                            <p className="truncate text-sm text-neutral-600" title={f.display}>
                              {f.display}
                            </p>
                          </div>
                          <ArrowRight className="hidden h-4 w-4 text-neutral-500 sm:block" aria-hidden="true" />
                          <label className="grid gap-1">
                            <span className="sr-only">Campo de destino para {f.name}</span>
                            <select
                              value={map[f.id] ?? ""}
                              onChange={(e) => setMap((m) => ({ ...m, [f.id]: e.target.value }))}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
                            >
                              <option value="">Não levar (fica num comentário)</option>
                              {options.map((t) => (
                                <option key={t.id} value={t.id} disabled={usedBy(t.id, f.id)}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                            {options.length === 0 && (
                              <span className="text-xs text-neutral-600">
                                O destino não tem campo deste tipo.
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-700">
                <p className="font-medium text-neutral-800">O que acontece ao enviar</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li>
                    O card entra na primeira etapa de <strong>{plan.targetName}</strong>, com um
                    número novo.
                  </li>
                  <li>Fica sem responsável: a gestão de lá define o novo dono e é avisada.</li>
                  <li>Comentários, checklists, anexos e histórico vão junto.</li>
                  {semPar > 0 && (
                    <li>
                      {semPar === 1 ? "1 campo sem par vira" : `${semPar} campos sem par viram`} um
                      comentário no card, para não se perder.
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!plan || busy}
            className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Enviando…" : plan ? `Enviar para ${plan.targetName}` : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
