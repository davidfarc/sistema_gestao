"use client";

import { useRef, useState } from "react";

import { syncFieldsFromBoard, type FieldSyncResult } from "@/lib/board/actions";
import type { BoardSummary } from "@/lib/board/types";
import { setBoardWhatsapp, type BoardWhatsapp } from "@/lib/board/whatsapp";
import { setBoardOptions } from "@/lib/time/actions";

import { WhatsappOptions } from "./WhatsappOptions";

/** Opções do pipeline: visão "Minhas demandas" e controle de tempo. */
export function BoardOptionsDialog({
  boardId,
  boardName,
  myTasks,
  timeTracking,
  ownPanel,
  boards = [],
  canSyncFields = false,
  onClose,
  onSaved,
}: {
  boardId: string;
  boardName: string;
  myTasks: boolean;
  timeTracking: boolean;
  ownPanel: boolean;
  /** Outros pipelines, para "Trazer propriedades de outro pipeline". */
  boards?: BoardSummary[];
  /** Quem pode criar propriedades (`field:manage`). */
  canSyncFields?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mt, setMt] = useState(myTasks);
  const [tt, setTt] = useState(timeTracking);
  const [op, setOp] = useState(ownPanel);
  const others = boards.filter((b) => b.id !== boardId && !b.archived);
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<FieldSyncResult | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function runSync(apply: boolean) {
    if (!sourceId) return;
    setSyncBusy(true);
    setSyncMsg(null);
    try {
      const res = await syncFieldsFromBoard(boardId, sourceId, apply);
      if (!res.ok) {
        setSyncMsg({ ok: false, text: res.error });
        return;
      }
      if (apply) {
        setPreview(null);
        setSyncMsg({ ok: true, text: "Propriedades sincronizadas." });
        onSaved();
      } else setPreview(res.result);
    } catch {
      setSyncMsg({ ok: false, text: "Não foi possível sincronizar. Tente de novo." });
    } finally {
      setSyncBusy(false);
    }
  }
  const nothingToDo = !!preview && preview.created.length === 0 && preview.optionsAdded.length === 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Atendimento pelo WhatsApp: só grava se a pessoa mexeu.
  const whatsapp = useRef<BoardWhatsapp | null>(null);

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
      if (whatsapp.current) {
        const wa = await setBoardWhatsapp(boardId, whatsapp.current);
        if (!wa.ok) {
          setError(`Atendimento pelo WhatsApp: ${wa.error}`);
          return;
        }
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
        </div>
        {canSyncFields && others.length > 0 && (
          <div className="grid gap-3 border-t border-neutral-200 p-5">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">Trazer propriedades de outro pipeline</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Copia para <strong>{boardName}</strong> as propriedades que faltam, e as opções que faltam nas
                que já existem, para os cards enviados de um pipeline para o outro chegarem com tudo no lugar.
                Não apaga nem altera nada do que já existe, e não mexe nas etapas.
                Esta parte não usa o “Salvar” lá embaixo: escolha a origem, clique em “Ver o que muda” e depois
                em “Trazer propriedades”.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-0 flex-1 gap-1 text-sm text-neutral-700">
                Pipeline de origem
                <select
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setPreview(null);
                    setSyncMsg(null);
                  }}
                  className="min-h-10 w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-2 text-sm"
                >
                  <option value="">Escolha…</option>
                  {others.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => runSync(false)}
                disabled={!sourceId || syncBusy}
                className="min-h-10 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 disabled:opacity-50"
              >
                {syncBusy && !preview ? "Conferindo…" : "Ver o que muda"}
              </button>
            </div>
            {preview && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800">
                {nothingToDo ? (
                  <p>Nada a trazer: as propriedades já estão iguais.</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {preview.created.length > 0 && (
                      <li className="break-words">
                        <strong>Serão criadas:</strong> {preview.created.join(", ")}.
                      </li>
                    )}
                    {preview.optionsAdded.map((o) => (
                      <li key={o.name} className="break-words">
                        <strong>Novas opções em “{o.name}”:</strong> {o.labels.join(", ")}.
                      </li>
                    ))}
                  </ul>
                )}
                {preview.conflicts.length > 0 && (
                  <p className="mt-2 break-words text-amber-800">
                    <strong>Ficam como estão</strong> (mesmo nome, tipo diferente nos dois pipelines):{" "}
                    {preview.conflicts.map((c) => c.name).join(", ")}. Ajuste o tipo em um dos dois, se quiser que
                    acompanhem o card.
                  </p>
                )}
                {preview.unchanged > 0 && (
                  <p className="mt-2 text-neutral-600">
                    {preview.unchanged} {preview.unchanged === 1 ? "propriedade já está igual" : "propriedades já estão iguais"}.
                  </p>
                )}
                {!nothingToDo && (
                  <button
                    type="button"
                    onClick={() => runSync(true)}
                    disabled={syncBusy}
                    className="mt-3 min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
                  >
                    {syncBusy ? "Sincronizando…" : "Trazer propriedades"}
                  </button>
                )}
              </div>
            )}
            {syncMsg && (
              <p role={syncMsg.ok ? "status" : "alert"} className={"text-sm " + (syncMsg.ok ? "text-emerald-700" : "text-red-700")}>
                {syncMsg.text}
              </p>
            )}
          </div>
        )}
        <WhatsappOptions
          boardId={boardId}
          boardName={boardName}
          onChange={(value, dirty) => {
            if (dirty) whatsapp.current = value;
          }}
        />
        {error && (
          <p role="alert" className="px-5 pb-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700">
            Fechar
          </button>
          <button type="button" onClick={save} disabled={busy} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50">
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
