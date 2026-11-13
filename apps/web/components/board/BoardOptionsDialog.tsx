"use client";

import { useState } from "react";

import { setBoardOptions } from "@/lib/time/actions";

/** Opções do pipeline: visão "Minhas demandas" e controle de tempo. */
export function BoardOptionsDialog({
  boardId,
  boardName,
  myTasks,
  timeTracking,
  ownPanel,
  onClose,
  onSaved,
}: {
  boardId: string;
  boardName: string;
  myTasks: boolean;
  timeTracking: boolean;
  ownPanel: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mt, setMt] = useState(myTasks);
  const [tt, setTt] = useState(timeTracking);
  const [op, setOp] = useState(ownPanel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await setBoardOptions(boardId, {
        myTasks: mt,
        timeTracking: tt,
        ...(op !== ownPanel ? { ownPanel: op } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Não foi possível salvar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const row = "flex items-start gap-3 rounded-lg border border-neutral-200 p-3 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-neutral-200 p-5">
          <h2 className="text-lg font-semibold text-neutral-800">Opções do pipeline</h2>
          <p className="mt-1 text-sm text-neutral-600">{boardName}. Kanban e Lista continuam como estão.</p>
        </div>
        <div className="grid gap-3 p-5">
          <label className={row}>
            <input type="checkbox" checked={mt} onChange={(e) => setMt(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-neutral-800">Visão “Minhas demandas”</span>
              <span className="block text-neutral-600">
                Cada pessoa vê só os cards em que é responsável, os atrasados primeiro. É a visão que abre
                para quem não gerencia o pipeline.
              </span>
            </span>
          </label>
          <label className={row}>
            <input type="checkbox" checked={tt} onChange={(e) => setTt(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-neutral-800">Controle de tempo por tarefa</span>
              <span className="block text-neutral-600">
                Cronômetro nos cards (iniciar, pausar, retomar). Mede o tempo gasto em cada tarefa para
                planejar prazos; não é registro de jornada.
              </span>
            </span>
          </label>
          <label className={row}>
            <input type="checkbox" checked={op} onChange={(e) => setOp(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-neutral-800">Painel próprio em “Painéis”</span>
              <span className="block text-neutral-600">
                Uma aba só deste pipeline: cards por etapa, por responsável e por propriedade, emendas,
                tempo até concluir e atrasados.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={busy} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50">
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
