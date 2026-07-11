"use client";

import { useEffect, useState, type FormEvent } from "react";

import { createCardWithFields, loadFields, loadMembers } from "@/lib/board/actions";
import type { FieldDef, FieldValueRaw, MemberOption } from "@/lib/board/types";
import { FieldEditor } from "./fieldControls";

function emptyRaw(fieldId: string): FieldValueRaw {
  return { fieldId, text: null, number: null, date: null, bool: null, memberId: null };
}

/**
 * Formulário de criação GENÉRICO: mostra os campos do pipeline marcados
 * "pedir na criação" (show_on_create), renderizados com o FieldEditor (modo
 * live), e cria o card com os valores de uma vez.
 */
export function GenericCreateForm({
  boardId,
  onClose,
  onCreated,
}: {
  boardId: string;
  onClose: () => void;
  onCreated: (cardId: string) => void;
}) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [title, setTitle] = useState("");
  const [entries, setEntries] = useState<
    Record<string, { submit: string | number | boolean | null; raw: FieldValueRaw }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    loadFields(boardId).then((fs) => setFields(fs.filter((f) => f.showOnCreate)));
    loadMembers().then(setMembers);
  }, [boardId]);

  function onSave(fieldId: string, value: string | number | boolean | null, patch: Partial<FieldValueRaw>) {
    setEntries((prev) => ({
      ...prev,
      [fieldId]: { submit: value, raw: { ...(prev[fieldId]?.raw ?? emptyRaw(fieldId)), ...patch } },
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Dê um nome ao card.");
      return;
    }
    const missing = fields.filter(
      (f) => f.isRequired && (entries[f.id]?.submit == null || entries[f.id]?.submit === ""),
    );
    if (missing.length > 0) {
      setError(`Preencha os campos obrigatórios: ${missing.map((f) => f.name).join(", ")}.`);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const values = fields.map((f) => ({ fieldId: f.id, value: entries[f.id]?.submit ?? null }));
      const id = await createCardWithFields(boardId, title, values);
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar o card.");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={() => !pending && onClose()}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-neutral-200 p-5">
          <h2 className="text-base font-semibold text-neutral-800">Novo card</h2>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome do card *"
            className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        {fields.length > 0 && (
          <div className="grid gap-3 p-5">
            {fields.map((f) => (
              <label key={f.id} className="grid gap-1">
                <span className="text-xs font-medium text-neutral-600">
                  {f.name}
                  {f.isRequired && <span className="ml-0.5 text-red-500">*</span>}
                </span>
                <div className="rounded-lg border border-neutral-200 px-1 py-0.5">
                  <FieldEditor
                    field={f}
                    value={entries[f.id]?.raw}
                    members={members}
                    onSave={(v, p) => onSave(f.id, v, p)}
                    live
                  />
                </div>
              </label>
            ))}
          </div>
        )}

        {error && <p className="px-5 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-60"
          >
            {pending ? "Criando…" : "Criar card"}
          </button>
        </div>
      </form>
    </div>
  );
}
