"use client";

import { DEFAULT_THRESHOLDS, validateThresholds, type Thresholds } from "@ecco/core";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { setBoardAlcadaThresholds } from "@/lib/board/actions";

const FIELDS: { key: keyof Thresholds; label: string; help: string }[] = [
  {
    key: "limiteFaixaA",
    label: "Limite da Faixa A (R$)",
    help: "Até este valor: trilha rápida — Gestor Financeiro ou Diretor Administrativo.",
  },
  {
    key: "limiteFaixaB",
    label: "Limite da Faixa B (R$)",
    help: "Acima da Faixa A e até aqui: comitê (Financeiro + Administrativo), com 3 cotações. Acima disso é Faixa C, na Direção Geral.",
  },
  {
    key: "limiteGrow",
    label: "Limite de Grow (R$)",
    help: "Demanda do tipo Grow acima deste valor vai direto para a Direção Geral.",
  },
  {
    key: "limiteAnualRecorrencia",
    label: "Limite anual de recorrência (R$/ano)",
    help: "Compra recorrente cujo custo anualizado passe disso vira decisão da Direção Geral.",
  },
];

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function AlcadasForm({ boardId, initial }: { boardId: string; initial: Thresholds }) {
  const router = useRouter();
  const [values, setValues] = useState<Thresholds>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Trocar de pipeline recarrega os limites vindos do servidor.
  useEffect(() => {
    setValues(initial);
    setError(null);
    setSaved(false);
  }, [initial, boardId]);

  function set(key: keyof Thresholds, raw: string) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: raw === "" ? 0 : Number(raw) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateThresholds(values);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setPending(true);
    const res = await setBoardAlcadaThresholds(boardId, values);
    setPending(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  const dirty = FIELDS.some((f) => values[f.key] !== initial[f.key]);

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 rounded-xl border border-surface-medium bg-surface-lowest p-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="grid gap-1">
            <span className="text-xs font-medium text-neutral-600">{f.label}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={values[f.key] || ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <span className="text-[11px] leading-tight text-neutral-400">{f.help}</span>
          </label>
        ))}
      </div>

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ A faixa é recalculada a cada consulta. Mudar um limite pode alterar a faixa — e quem
        precisa aprovar — de demandas que ainda estão pendentes.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !dirty && <p className="text-sm text-emerald-700">Limites salvos.</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar limites"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValues(DEFAULT_THRESHOLDS);
            setSaved(false);
          }}
          className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800"
        >
          Restaurar padrão ({brl(DEFAULT_THRESHOLDS.limiteFaixaA)} /{" "}
          {brl(DEFAULT_THRESHOLDS.limiteFaixaB)})
        </button>
      </div>
    </form>
  );
}
