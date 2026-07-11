"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  setBoardCreationForm,
  toggleFieldOnCreate,
  toggleFieldRequired,
} from "@/lib/board/actions";
import type { FieldDef } from "@/lib/board/types";
import { useBoardId, useCreationForm } from "./BoardContext";
import { CUSTOM_FORMS } from "./customForms";

/**
 * Configura o formulário de criação do pipeline: o modo (Simples/Genérico/
 * Personalizado) e, no modo Genérico, quais propriedades aparecem e quais são
 * obrigatórias.
 */
export function CreateFormConfig({
  fields,
  onChanged,
  onClose,
}: {
  fields: FieldDef[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const boardId = useBoardId();
  const mode = useCreationForm();
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(fields);

  async function changeMode(m: string) {
    setBusy(true);
    await setBoardCreationForm(boardId, m);
    setBusy(false);
    router.refresh();
  }

  async function toggleCreate(f: FieldDef) {
    const next = !f.showOnCreate;
    setItems((prev) => prev.map((x) => (x.id === f.id ? { ...x, showOnCreate: next } : x)));
    await toggleFieldOnCreate(f.id, next);
    onChanged();
  }

  async function toggleReq(f: FieldDef) {
    const next = !f.isRequired;
    setItems((prev) => prev.map((x) => (x.id === f.id ? { ...x, isRequired: next } : x)));
    await toggleFieldRequired(f.id, next);
    onChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">Formulário de criação</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1 p-4">
          <span className="text-xs font-medium text-neutral-600">Tipo</span>
          <select
            value={mode}
            onChange={(e) => changeMode(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
          >
            <option value="simple">Simples (só título)</option>
            <option value="generic">Genérico (propriedades marcadas)</option>
            {Object.entries(CUSTOM_FORMS).map(([key, f]) => (
              <option key={key} value={`custom:${key}`}>
                {f.label} (personalizado)
              </option>
            ))}
          </select>
        </div>

        {mode === "generic" ? (
          <div className="border-t border-neutral-100 p-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
              <span>Propriedade</span>
              <span>Pedir</span>
              <span>Obrig.</span>
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {items.map((f) => (
                <li
                  key={f.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md px-2 py-1.5 hover:bg-neutral-50"
                >
                  <span className="truncate text-sm text-neutral-700">{f.name}</span>
                  <input
                    type="checkbox"
                    checked={f.showOnCreate}
                    onChange={() => toggleCreate(f)}
                    className="h-4 w-4 rounded border-neutral-300"
                    aria-label="Pedir na criação"
                  />
                  <input
                    type="checkbox"
                    checked={f.isRequired}
                    disabled={!f.showOnCreate}
                    onChange={() => toggleReq(f)}
                    className="h-4 w-4 rounded border-neutral-300 disabled:opacity-30"
                    aria-label="Obrigatório"
                  />
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-2 py-3 text-xs text-neutral-400">
                  Nenhuma propriedade neste pipeline ainda.
                </li>
              )}
            </ul>
          </div>
        ) : (
          <p className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
            {mode === "simple"
              ? "Ao criar um card, pede só o título."
              : "Formulário personalizado (layout próprio)."}
          </p>
        )}
      </div>
    </div>
  );
}
