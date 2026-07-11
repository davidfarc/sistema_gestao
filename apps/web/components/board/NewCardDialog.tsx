"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { createCard } from "@/lib/board/actions";
import { useBoardId, useCreationForm } from "./BoardContext";
import { CUSTOM_FORMS } from "./customForms";
import { GenericCreateForm } from "./GenericCreateForm";

/** Botão "Novo card" que abre o formulário conforme o modo do pipeline. */
export function NewCardDialog() {
  const router = useRouter();
  const boardId = useBoardId();
  const mode = useCreationForm();
  const [open, setOpen] = useState(false);

  function done() {
    setOpen(false);
    router.refresh();
  }

  const customKey = mode.startsWith("custom:") ? mode.slice("custom:".length) : null;
  const CustomForm = customKey ? CUSTOM_FORMS[customKey]?.Component : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-high"
      >
        + Novo card
      </button>

      {open &&
        (mode === "generic" ? (
          <GenericCreateForm boardId={boardId} onClose={() => setOpen(false)} onCreated={done} />
        ) : CustomForm ? (
          <CustomForm boardId={boardId} onClose={() => setOpen(false)} onCreated={done} />
        ) : (
          <SimpleCreate boardId={boardId} onClose={() => setOpen(false)} onCreated={done} />
        ))}
    </>
  );
}

/** Formulário simples: só o título (modo 'simple' e fallback). */
function SimpleCreate({
  boardId,
  onClose,
  onCreated,
}: {
  boardId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Dê um nome ao card.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createCard(boardId, title);
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao criar o card.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !pending && onClose()}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-neutral-800">Novo card</h2>
        <p className="mt-0.5 text-xs text-neutral-400">
          Só o nome. O #ID é automático; as propriedades você preenche depois.
        </p>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome do card"
          className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
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
