"use client";

import { BRACKET_LABEL, TRACK_LABEL } from "@ecco/core";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { loadDemandPanel, submitApproval } from "@/lib/demandas/actions";
import type { DemandPanelData } from "@/lib/demandas/eval";

const STATUS_STYLE: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-700",
  aprovada: "bg-emerald-100 text-emerald-700",
  reprovada: "bg-rose-100 text-rose-700",
};

function brl(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function DemandPanel({ cardId }: { cardId: string }) {
  const [data, setData] = useState<DemandPanelData | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDemandPanel(cardId).then((d) => {
      if (active) setData(d);
    });
    return () => {
      active = false;
    };
  }, [cardId]);

  if (!data) return null; // carregando (undefined) ou não é demanda (null)

  async function vote(approved: boolean) {
    setBusy(true);
    setError(null);
    const res = await submitApproval(cardId, approved, note);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote("");
    setData(await loadDemandPanel(cardId));
  }

  return (
    <div className="border-b border-neutral-100 bg-surface-low/40 p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Demanda</p>
        <span
          className={
            "rounded px-2 py-0.5 text-xs font-semibold capitalize " +
            (STATUS_STYLE[data.status] ?? "")
          }
        >
          {data.status}
        </span>
      </div>

      {/* Resumo da alçada */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-neutral-800">{BRACKET_LABEL[data.bracket]}</span>
        <span className="text-sm text-neutral-600">{TRACK_LABEL[data.track]}</span>
        <span className="text-xs text-neutral-400">
          SLA {data.slaDias.min}–{data.slaDias.max} dias úteis
          {data.rice != null && ` · RICE ${data.rice.toFixed(1)}`}
          {data.effort.total != null && (
            <span title="Esforço = tempo (meses) + complexidade + orçamento">
              {" "}
              · Esforço {data.effort.total} ({data.effort.tempoMeses}+{data.effort.complexidade}+
              {data.effort.orcamentoScore})
            </span>
          )}
        </span>
      </div>

      {/* Campos-chave */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <Field k="Tipo" v={data.fields.tipo} />
        <Field k="Orçamento" v={brl(data.fields.orcamento)} />
        <Field k="Urgência" v={data.fields.urgencia} />
        <Field k="Risco" v={data.fields.risco} />
        <Field k="Área" v={data.fields.area} />
        {data.fields.isList && <Field k="Lista" v="sim" />}
      </dl>

      {/* Vagas de aprovação */}
      <p className="mt-4 text-xs font-medium text-neutral-500">Aprovação</p>
      <ul className="mt-1 grid gap-1">
        {data.slots.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {s.by ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <span className="h-4 w-4 rounded-full border border-neutral-300" />
            )}
            <span className={s.by ? "text-neutral-700" : "text-neutral-400"}>{s.label}</span>
            {s.by && <span className="text-xs text-neutral-400">· {s.by}</span>}
          </li>
        ))}
      </ul>

      {/* Votos com nota */}
      {data.approvals.some((a) => a.note) && (
        <ul className="mt-2 grid gap-1 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
          {data.approvals
            .filter((a) => a.note)
            .map((a, i) => (
              <li key={i}>
                <span className={a.approved ? "text-emerald-700" : "text-rose-700"}>
                  {a.approved ? "aprovou" : "reprovou"}
                </span>{" "}
                <span className="font-medium text-neutral-600">{a.approverName}</span>: {a.note}
              </li>
            ))}
        </ul>
      )}

      {/* Ações de voto */}
      {data.canApprove && (
        <div className="mt-3 grid gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Observação (opcional)"
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => vote(false)}
              className="flex items-center gap-1 rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
            >
              <X className="h-4 w-4" /> Reprovar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => vote(true)}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Check className="h-4 w-4" /> Aprovar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <dt className="text-neutral-400">{k}</dt>
      <dd className="font-medium text-neutral-700">{v || "—"}</dd>
    </div>
  );
}
