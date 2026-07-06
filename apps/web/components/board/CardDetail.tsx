"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { loadTaxonomyOptions, updateCard } from "@/app/board/actions";
import type { CardView, StageView, TaxonomyOption } from "@/lib/board/types";

const BIMESTRES = [
  { value: 1, label: "1º bimestre" },
  { value: 2, label: "2º bimestre" },
  { value: 3, label: "3º bimestre" },
  { value: 4, label: "4º bimestre" },
  { value: 0, label: "Anual (volume único)" },
] as const;

export function CardDetail({
  card,
  stage,
  onClose,
}: {
  card: CardView;
  stage: StageView | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [materias, setMaterias] = useState<TaxonomyOption[]>([]);
  const [series, setSeries] = useState<TaxonomyOption[]>([]);
  const [title, setTitle] = useState(card.title);
  const [materiaId, setMateriaId] = useState(card.materiaId ?? "");
  const [serieId, setSerieId] = useState(card.serieId ?? "");
  const [bimestre, setBimestre] = useState<number>(card.materiaId ? card.bimestre : 1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTaxonomyOptions().then(({ materias, series }) => {
      setMaterias(materias);
      setSeries(series);
    });
  }, []);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCard({
          id: card.id,
          title,
          materiaId: materiaId || null,
          serieId: serieId || null,
          bimestre,
        });
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao salvar.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={() => !pending && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-200 p-5">
          <div>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="font-medium text-neutral-500">#{card.number}</span>
              {card.code ? (
                <span className="font-mono">{card.code}</span>
              ) : (
                <span className="italic">sem código ainda</span>
              )}
              {stage && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                  {stage.name}
                </span>
              )}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full text-lg font-semibold text-neutral-800 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Taxonomia */}
        <div className="grid gap-3 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Taxonomia
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Matéria">
              <Select value={materiaId} onChange={setMateriaId}>
                <option value="">—</option>
                {materias.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Série">
              <Select value={serieId} onChange={setSerieId}>
                <option value="">—</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Bimestre">
            <Select value={String(bimestre)} onChange={(v) => setBimestre(Number(v))}>
              {BIMESTRES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-neutral-400">
            O código do card é gerado automaticamente quando matéria, série e bimestre
            estiverem preenchidos.
          </p>
        </div>

        {/* Seções futuras (estrutura) */}
        <div className="grid gap-2 border-t border-neutral-100 p-5">
          <SoonSection title="Checklists" />
          <SoonSection title="Anexos (links do Drive)" />
          <SoonSection title="Comentários" />
        </div>

        {error && <p className="px-5 text-sm text-red-600">{error}</p>}

        {/* Footer */}
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
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-neutral-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
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

function SoonSection({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
      <span className="text-sm font-medium text-neutral-600">{title}</span>
      <span className="text-[11px] text-neutral-400">em breve</span>
    </div>
  );
}
