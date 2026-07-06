"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { createCard } from "@/app/board/actions";
import type { TaxonomyOption } from "@/lib/board/types";

const BIMESTRES = [
  { value: 1, label: "1º bimestre" },
  { value: 2, label: "2º bimestre" },
  { value: 3, label: "3º bimestre" },
  { value: 4, label: "4º bimestre" },
  { value: 0, label: "Anual (volume único)" },
] as const;

export function NewCardDialog({
  materias,
  series,
}: {
  materias: TaxonomyOption[];
  series: TaxonomyOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [materiaId, setMateriaId] = useState("");
  const [serieId, setSerieId] = useState("");
  const [bimestre, setBimestre] = useState<number>(1);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!materiaId || !serieId) {
      setError("Escolha matéria e série.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createCard({
          materiaId,
          serieId,
          bimestre: bimestre as 0 | 1 | 2 | 3 | 4,
          title,
        });
        setTitle("");
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao criar o card.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700"
      >
        + Novo card
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold text-neutral-800">Novo card</h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              Matéria × série × bimestre. O #ID e o código são gerados automaticamente.
            </p>

            <div className="mt-4 grid gap-3">
              <Field label="Matéria">
                <Select value={materiaId} onChange={setMateriaId}>
                  <option value="">Selecione…</option>
                  {materias.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Série">
                <Select value={serieId} onChange={setSerieId}>
                  <option value="">Selecione…</option>
                  {series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Bimestre">
                <Select value={String(bimestre)} onChange={(v) => setBimestre(Number(v))}>
                  {BIMESTRES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Título (opcional)">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Gerado da taxonomia se vazio"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
                />
              </Field>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-neutral-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
              >
                {pending ? "Criando…" : "Criar card"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
    >
      {children}
    </select>
  );
}
