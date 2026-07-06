"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { addStage } from "@/lib/board/actions";

export function NewStageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    await addStage(name);
    setName("");
    setOpen(false);
    setPending(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-fit w-64 shrink-0 rounded-xl border-2 border-dashed border-neutral-200 p-3 text-sm text-neutral-400 transition-colors hover:border-neutral-300 hover:text-neutral-600"
      >
        + Nova etapa
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-64 shrink-0 rounded-xl border border-neutral-200 bg-white p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da etapa"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-high disabled:opacity-60"
        >
          Adicionar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 hover:text-neutral-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
