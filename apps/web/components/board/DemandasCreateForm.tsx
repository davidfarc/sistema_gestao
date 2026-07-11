"use client";

import {
  BRACKET_LABEL,
  TRACK_LABEL,
  evaluate,
  riceScore,
  type RiskLevel,
  type TipoDemanda,
} from "@ecco/core";
import clsx from "clsx";
import { Package, Repeat, Rocket, Shield, TrendingUp, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { createCardWithFields, loadFields } from "@/lib/board/actions";
import type { FieldDef } from "@/lib/board/types";
import type { CustomFormProps } from "./customForms";

// Ícone + descrição de cada tipo (chave = label da opção, em maiúsculas).
const TIPO_META: Record<string, { desc: string; Icon: LucideIcon }> = {
  RUN: { desc: "Manter operação — despesa recorrente do dia a dia.", Icon: Repeat },
  KEEP: { desc: "Sustentar / manter algo existente funcionando.", Icon: Shield },
  GROW: { desc: "Crescer / expandir capacidade instalada.", Icon: TrendingUp },
  TRANSFORM: { desc: "Mudança estrutural, novo modelo. Vai à Direção Geral.", Icon: Rocket },
};

// Nomes das propriedades no board (contrato com a migration 0016 + já existentes).
const F = {
  tipo: "Tipo de demanda",
  area: "Área beneficiada",
  urgencia: "Urgência",
  risco: "Risco percebido",
  orcamento: "Orçamento estimado (R$)",
  custoAnual: "Custo anualizado (R$/ano)",
  data: "Data pretendida",
  recorrente: "Compra recorrente",
  fornecedorUnico: "Fornecedor único",
  foraOrcamento: "Fora do orçamento planejado",
  reversibilidade: "Reversibilidade baixa",
  fracionamento: "Fracionamento (30 dias)",
  isList: "É lista de compras?",
  justificativa: "Justificativa",
  cotacoes: "Cotações / evidências",
  riceAlcance: "RICE - Alcance",
  riceImpacto: "RICE - Impacto",
  riceConfianca: "RICE - Confiança (%)",
  riceEsforco: "RICE - Esforço",
} as const;

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function titleCase(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s;
}

export function DemandasCreateForm({ boardId, onClose, onCreated }: CustomFormProps) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
  const field = (name: string) => byName.get(name);
  const optLabel = (name: string, id: string) =>
    field(name)?.options.find((o) => o.id === id)?.label ?? "";

  // Estado do formulário (selects guardam o id da opção).
  const [nome, setNome] = useState("");
  const [tipoOpt, setTipoOpt] = useState("");
  const [areaOpt, setAreaOpt] = useState("");
  const [urgenciaOpt, setUrgenciaOpt] = useState("");
  const [riscoOpt, setRiscoOpt] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [data, setData] = useState("");
  const [recorrente, setRecorrente] = useState(false);
  const [custoAnual, setCustoAnual] = useState("");
  const [fornecedorUnico, setFornecedorUnico] = useState(false);
  const [foraOrcamento, setForaOrcamento] = useState(false);
  const [reversibilidade, setReversibilidade] = useState(false);
  const [fracionamento, setFracionamento] = useState(false);
  const [isList, setIsList] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [cotacoes, setCotacoes] = useState("");
  const [riceAlcance, setRiceAlcance] = useState("");
  const [riceImpactoOpt, setRiceImpactoOpt] = useState("");
  const [riceConfianca, setRiceConfianca] = useState("");
  const [riceEsforco, setRiceEsforco] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    loadFields(boardId).then((fs) => {
      setFields(fs);
      // defaults amigáveis: Tipo=RUN, Urgência=Normal (se existirem).
      const t = fs.find((f) => f.name === F.tipo)?.options.find((o) => o.label.toUpperCase() === "RUN");
      if (t) setTipoOpt(t.id);
      const u = fs.find((f) => f.name === F.urgencia)?.options.find((o) => o.label.toLowerCase().startsWith("normal"));
      if (u) setUrgenciaOpt(u.id);
    });
  }, [boardId]);

  // Alçada em tempo real.
  const alcada = useMemo(() => {
    const tipoLabel = optLabel(F.tipo, tipoOpt);
    const tipo = (tipoLabel ? titleCase(tipoLabel) : null) as TipoDemanda | null;
    const risco = (optLabel(F.risco, riscoOpt) || null) as RiskLevel | null;
    return evaluate({
      tipo,
      orcamento: numOrNull(orcamento),
      risco,
      recorrente,
      custoAnualizado: numOrNull(custoAnual),
      fornecedorUnico,
      foraDoOrcamento: foraOrcamento,
      reversibilidadeBaixa: reversibilidade,
      reclassificadoTransform: false,
      fracionamentoDetectado: fracionamento,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoOpt, riscoOpt, orcamento, recorrente, custoAnual, fornecedorUnico, foraOrcamento, reversibilidade, fracionamento, fields]);

  const rice = useMemo(
    () =>
      riceScore({
        reach: numOrNull(riceAlcance),
        impact: numOrNull(optLabel(F.riceImpacto, riceImpactoOpt)),
        confidence: numOrNull(riceConfianca),
        effort: numOrNull(riceEsforco),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [riceAlcance, riceImpactoOpt, riceConfianca, riceEsforco, fields],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      setError("Dê um nome à demanda.");
      return;
    }
    if (alcada.requiresEvidences && (!justificativa.trim() || !cotacoes.trim())) {
      setError(`Faixa ${alcada.bracket} exige justificativa e cotações (mín. ${alcada.minCotacoes}).`);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const v: { fieldId: string; value: string | number | boolean | null }[] = [];
      const put = (name: string, value: string | number | boolean | null) => {
        const f = field(name);
        if (f) v.push({ fieldId: f.id, value });
      };
      put(F.tipo, tipoOpt || null);
      put(F.area, areaOpt || null);
      put(F.urgencia, urgenciaOpt || null);
      put(F.risco, riscoOpt || null);
      put(F.orcamento, numOrNull(orcamento));
      put(F.data, data || null);
      put(F.recorrente, recorrente);
      put(F.custoAnual, recorrente ? numOrNull(custoAnual) : null);
      put(F.fornecedorUnico, fornecedorUnico);
      put(F.foraOrcamento, foraOrcamento);
      put(F.reversibilidade, reversibilidade);
      put(F.fracionamento, fracionamento);
      put(F.isList, isList);
      put(F.justificativa, justificativa || null);
      put(F.cotacoes, cotacoes || null);
      put(F.riceAlcance, numOrNull(riceAlcance));
      put(F.riceImpacto, riceImpactoOpt || null);
      put(F.riceConfianca, numOrNull(riceConfianca));
      put(F.riceEsforco, numOrNull(riceEsforco));
      const id = await createCardWithFields(boardId, nome, v);
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a demanda.");
      setPending(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500";
  const selectOptions = (name: string) =>
    (field(name)?.options ?? []).map((o) => (
      <option key={o.id} value={o.id}>
        {o.label}
      </option>
    ));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={() => !pending && onClose()}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="grid w-full max-w-3xl gap-0 rounded-xl bg-white shadow-xl lg:grid-cols-[1fr_16rem]"
      >
        {/* Coluna do formulário */}
        <div className="min-w-0 border-b border-neutral-100 lg:border-b-0 lg:border-r">
          <div className="border-b border-neutral-100 p-4">
            <h2 className="text-base font-semibold text-neutral-800">Nova demanda</h2>
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome da demanda *"
              className={inputCls + " mt-2"}
            />
          </div>

          <div className="grid gap-3 p-4">
            {/* Tipo — botões com ícone + descrição (tons de azul) */}
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-600">Tipo</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(field(F.tipo)?.options ?? []).map((o) => {
                  const meta = TIPO_META[o.label.toUpperCase()];
                  const Icon = meta?.Icon ?? Package;
                  const sel = tipoOpt === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setTipoOpt(o.id)}
                      className={clsx(
                        "flex flex-col gap-1 rounded-xl border p-3 text-left transition",
                        sel
                          ? "border-primary bg-primary text-white shadow-sm"
                          : "border-blue-100 bg-blue-50/50 text-neutral-700 hover:border-blue-300 hover:bg-blue-50",
                      )}
                    >
                      <Icon className={clsx("h-4 w-4", sel ? "text-white" : "text-primary")} />
                      <span className="text-sm font-semibold">{titleCase(o.label)}</span>
                      {meta && (
                        <span
                          className={clsx(
                            "text-[11px] leading-tight",
                            sel ? "text-white/80" : "text-neutral-500",
                          )}
                        >
                          {meta.desc}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Label t="Área beneficiada">
                <select value={areaOpt} onChange={(e) => setAreaOpt(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {selectOptions(F.area)}
                </select>
              </Label>
              <Label t="Orçamento estimado (R$)">
                <input type="number" min={0} value={orcamento} onChange={(e) => setOrcamento(e.target.value)} placeholder="0,00" className={inputCls} />
              </Label>
              <Label t="Data pretendida">
                <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
              </Label>
              <Label t="Urgência">
                <select value={urgenciaOpt} onChange={(e) => setUrgenciaOpt(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {selectOptions(F.urgencia)}
                </select>
              </Label>
              <Label t="Risco percebido">
                <select value={riscoOpt} onChange={(e) => setRiscoOpt(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {selectOptions(F.risco)}
                </select>
              </Label>
            </div>

            <Check label="Compra recorrente (assinatura, mensalidade)" checked={recorrente} onChange={setRecorrente} />
            {recorrente && (
              <Label t="Custo anualizado (R$/ano)">
                <input type="number" min={0} value={custoAnual} onChange={(e) => setCustoAnual(e.target.value)} placeholder="12x o valor mensal" className={inputCls} />
              </Label>
            )}
            <Check label="É uma lista de compras" checked={isList} onChange={setIsList} />

            <p className="pt-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Gatilhos de elevação</p>
            <Check label="Fornecedor único / dispensa de cotação" checked={fornecedorUnico} onChange={setFornecedorUnico} />
            <Check label="Fora do orçamento planejado do período" checked={foraOrcamento} onChange={setForaOrcamento} />
            <Check label="Reversibilidade baixa (contrato longo, migração…)" checked={reversibilidade} onChange={setReversibilidade} />
            <Check label="Compras similares (30 dias) já ultrapassam o limite" checked={fracionamento} onChange={setFracionamento} />

            <p className="pt-1 text-xs font-medium uppercase tracking-wide text-neutral-400">RICE</p>
            <div className="grid grid-cols-2 gap-3">
              <Label t="Alcance"><input type="number" value={riceAlcance} onChange={(e) => setRiceAlcance(e.target.value)} className={inputCls} /></Label>
              <Label t="Impacto">
                <select value={riceImpactoOpt} onChange={(e) => setRiceImpactoOpt(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {selectOptions(F.riceImpacto)}
                </select>
              </Label>
              <Label t="Confiança (%)"><input type="number" value={riceConfianca} onChange={(e) => setRiceConfianca(e.target.value)} className={inputCls} /></Label>
              <Label t="Esforço"><input type="number" value={riceEsforco} onChange={(e) => setRiceEsforco(e.target.value)} className={inputCls} /></Label>
            </div>

            {alcada.requiresEvidences && (
              <>
                <p className="pt-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Evidências (Faixa {alcada.bracket})
                </p>
                <Label t="Justificativa *">
                  <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} className={inputCls} />
                </Label>
                <Label t="Cotações / evidências *">
                  <textarea value={cotacoes} onChange={(e) => setCotacoes(e.target.value)} rows={3} className={inputCls + " font-mono"} placeholder="Uma cotação por linha: https://… — R$ …" />
                </Label>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-neutral-100 p-4">
            <button type="button" onClick={onClose} disabled={pending} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-60">
              {pending ? "Criando…" : "Criar demanda"}
            </button>
          </div>
        </div>

        {/* Painel de alçada em tempo real */}
        <aside className="bg-surface-low p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Trilha de aprovação</p>
          <p className="mt-1 text-lg font-semibold text-neutral-800">{BRACKET_LABEL[alcada.bracket]}</p>
          <p className="text-neutral-600">{TRACK_LABEL[alcada.track]}</p>
          <p className="mt-2 text-xs text-neutral-500">
            SLA {alcada.slaDias.min}–{alcada.slaDias.max} dias úteis
          </p>

          <p className="mt-3 text-xs font-medium text-neutral-500">Aprova:</p>
          <ul className="text-xs text-neutral-600">
            {alcada.approvers.map((a, i) => (
              <li key={i}>• {a.or ? `${a.role} ou ${a.or.join(" / ")}` : a.role}</li>
            ))}
          </ul>

          {rice != null && (
            <p className="mt-3 text-xs text-neutral-500">
              RICE: <span className="font-semibold text-neutral-700">{rice.toFixed(1)}</span>
            </p>
          )}

          {alcada.triggers.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-neutral-500">Por quê:</p>
              <ul className="space-y-1 text-[11px] text-neutral-500">
                {alcada.triggers.map((t) => (
                  <li key={t.kind}>• {t.message}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </form>
    </div>
  );
}

function Label({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-neutral-600">{t}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-neutral-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-neutral-300" />
      <span>{label}</span>
    </label>
  );
}
