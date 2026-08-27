"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { repeatAcrossMonths, savePlanCell } from "@/lib/planejamento/plan";
import { MESES, type PlanGrid as Grid } from "@/lib/planejamento/types";

/** "1.234,50" e "1234.50" entram; texto solto vira null (não zera por acidente). */
function parseBRL(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return 0;
  const limpo = s.replace(/[R$\s]/g, "");
  // Se tem vírgula, ela é o decimal e o ponto é separador de milhar.
  const norm = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fmt(n: number): string {
  if (n === 0) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function brlTotal(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function PlanGrid({ grid, canEdit }: { grid: Grid; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState(grid.amounts);
  const [focus, setFocus] = useState<{ cat: string; month: number } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cellKey = (cat: string, month: number) => cat + ":" + month;
  const valueOf = (cat: string, month: number) => amounts[cat]?.[month] ?? 0;

  function setLocal(cat: string, month: number, v: number) {
    setAmounts((prev) => ({ ...prev, [cat]: { ...(prev[cat] ?? {}), [month]: v } }));
  }

  async function commit(cat: string, month: number, raw: string) {
    const parsed = parseBRL(raw);
    if (parsed === null) {
      setError("Valor não reconhecido — use apenas números, por exemplo 12500 ou 12.500,00.");
      return;
    }
    if (parsed === valueOf(cat, month)) return; // nada mudou

    const key = cellKey(cat, month);
    setError(null);
    setSaving(key);
    setLocal(cat, month, parsed);
    const res = await savePlanCell({
      boardId: grid.boardId,
      year: grid.year,
      month,
      categoryId: cat,
      amount: parsed,
    });
    setSaving(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(key);
    setTimeout(() => setSaved((k) => (k === key ? null : k)), 1500);
    startTransition(() => router.refresh());
  }

  async function repetir(cat: string, month: number) {
    setError(null);
    setSaving(cellKey(cat, month));
    const res = await repeatAcrossMonths({
      boardId: grid.boardId,
      year: grid.year,
      fromMonth: month,
      categoryId: cat,
    });
    setSaving(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const v = valueOf(cat, month);
    setAmounts((prev) => {
      const linha = { ...(prev[cat] ?? {}) };
      for (let m = month + 1; m <= 12; m++) linha[m] = v;
      return { ...prev, [cat]: linha };
    });
    startTransition(() => router.refresh());
  }

  const totalMes = (month: number) => grid.categories.reduce((s, c) => s + valueOf(c.id, month), 0);
  const totalCategoria = (cat: string) => MESES.reduce((s, _, i) => s + valueOf(cat, i + 1), 0);
  const totalAno = grid.categories.reduce((s, c) => s + totalCategoria(c.id), 0);

  if (grid.categories.length === 0) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        O campo &ldquo;Área beneficiada&rdquo; não tem opções cadastradas — sem elas não há linhas
        para planejar. Cadastre as áreas nas propriedades do pipeline.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-50">
              <th className="sticky left-0 z-10 min-w-44 bg-neutral-50 px-3 py-2 text-left font-semibold text-neutral-600">
                Área
              </th>
              {MESES.map((m) => (
                <th key={m} className="min-w-20 px-2 py-2 text-right font-medium text-neutral-600">
                  {m}
                </th>
              ))}
              <th className="min-w-28 px-3 py-2 text-right font-semibold text-neutral-600">Ano</th>
            </tr>
          </thead>
          <tbody>
            {grid.categories.map((cat) => (
              <tr key={cat.id} className="border-t border-neutral-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium">{cat.label}</td>
                {MESES.map((_, i) => {
                  const month = i + 1;
                  const key = cellKey(cat.id, month);
                  const isFocus = focus?.cat === cat.id && focus.month === month;
                  return (
                    <td key={month} className="relative px-1 py-1">
                      <input
                        inputMode="decimal"
                        disabled={!canEdit}
                        defaultValue={fmt(valueOf(cat.id, month))}
                        onFocus={() => setFocus({ cat: cat.id, month })}
                        onBlur={(e) => {
                          setFocus(null);
                          void commit(cat.id, month, e.target.value);
                        }}
                        placeholder="—"
                        aria-label={cat.label + ", " + MESES[i]}
                        className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right tabular-nums hover:border-neutral-200 focus:border-blue-400 focus:bg-white focus:outline-none disabled:cursor-not-allowed"
                      />
                      {saving === key && (
                        <Loader2 className="absolute right-1 top-2 h-3 w-3 animate-spin text-neutral-400" />
                      )}
                      {saved === key && (
                        <Check className="absolute right-1 top-2 h-3 w-3 text-emerald-600" />
                      )}
                      {/* Repetir para os meses seguintes: só na célula focada, para não
                          poluir uma grade que já tem 12 colunas. */}
                      {isFocus && canEdit && month < 12 && (
                        <button
                          type="button"
                          // onMouseDown roda antes do blur do input — sem isto o clique
                          // se perderia no re-render.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            void repetir(cat.id, month);
                          }}
                          title={"Repetir este valor de " + MESES[i] + " até dez"}
                          className="absolute -right-1 top-1/2 z-20 -translate-y-1/2 rounded bg-blue-600 p-0.5 text-white shadow hover:bg-blue-700"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-neutral-700">
                  {totalCategoria(cat.id) > 0 ? brlTotal(totalCategoria(cat.id)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-300 bg-neutral-50">
              <td className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 font-semibold">Total</td>
              {MESES.map((_, i) => (
                <td
                  key={i}
                  className="px-2 py-2 text-right text-xs font-semibold tabular-nums text-neutral-700"
                >
                  {totalMes(i + 1) > 0 ? brlTotal(totalMes(i + 1)) : "—"}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {totalAno > 0 ? brlTotal(totalAno) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-secondary">
        {canEdit
          ? "O valor é salvo ao sair do campo. Com o campo selecionado, a setinha azul repete o valor até dezembro."
          : "Você tem acesso de leitura. Para editar é preciso a permissão “Editar planejamento de gastos”."}
        {pending && " · atualizando…"}
      </p>
    </div>
  );
}
