import {
  DEFAULT_THRESHOLDS,
  budgetEffortScore,
  effortScore,
  evaluate,
  riceScore,
  scoreFromLabel,
  type Approver,
  type Bracket,
  type RiskLevel,
  type RuleOutput,
  type Thresholds,
  type TipoDemanda,
  type Track,
  type TriggerKind,
} from "@ecco/core";

import type { FieldDef, FieldValueRaw } from "@/lib/board/types";
import { DF } from "./fields";

// ── Aprovação ────────────────────────────────────────────────────────────────

export interface ApprovalRow {
  approverName: string;
  cargo: string | null;
  approved: boolean;
  note: string | null;
  at: string;
}

export interface Slot {
  label: string;
  eligible: string[]; // cargos que podem preencher a vaga
}

export type DemandStatus = "pendente" | "aprovada" | "reprovada";

/** Dados do painel de demanda (resumo da alçada + estado das aprovações). */
export interface DemandPanelData {
  bracket: Bracket;
  track: Track;
  slaDias: { min: number; max: number };
  rice: number | null;
  /** Esforço calculado, para mostrar a conta (tempo + complexidade + orçamento). */
  effort: DemandComputed["effort"];
  triggers: { kind: TriggerKind; message: string }[];
  fields: {
    tipo: string | null;
    orcamento: number | null;
    area: string | null;
    urgencia: string | null;
    risco: string | null;
    isList: boolean;
  };
  slots: { label: string; by: string | null }[];
  approvals: ApprovalRow[];
  status: DemandStatus;
  canApprove: boolean;
}

/** Vagas de aprovação a partir dos aprovadores da alçada. */
export function slotsOf(approvers: Approver[]): Slot[] {
  return approvers.map((a) => ({
    label: a.or ? `${a.role} ou ${a.or.join(" / ")}` : a.role,
    eligible: [a.role, ...(a.or ?? [])],
  }));
}

/**
 * Resolve o estado das vagas a partir dos votos. Reprovada se houver qualquer
 * voto negativo; aprovada se todas as vagas forem preenchidas (casamento guloso
 * cargo→vaga); senão pendente.
 */
export function resolveApprovals(
  slots: Slot[],
  approvals: ApprovalRow[],
): { slotStatus: { label: string; by: string | null }[]; status: DemandStatus } {
  const slotStatus = slots.map((s) => ({ label: s.label, by: null as string | null }));

  if (approvals.some((a) => !a.approved)) {
    return { slotStatus, status: "reprovada" };
  }

  const used = new Set<number>();
  for (const a of approvals) {
    if (!a.cargo) continue;
    const idx = slots.findIndex((s, i) => !used.has(i) && s.eligible.includes(a.cargo!));
    if (idx >= 0) {
      used.add(idx);
      slotStatus[idx]!.by = a.approverName;
    }
  }

  const status: DemandStatus = slotStatus.every((s) => s.by !== null) ? "aprovada" : "pendente";
  return { slotStatus, status };
}

/** O cargo ainda pode preencher alguma vaga em aberto? */
export function cargoCanFillSlot(slots: Slot[], approvals: ApprovalRow[], cargo: string | null): boolean {
  if (!cargo) return false;
  if (approvals.some((a) => !a.approved)) return false;
  const { slotStatus } = resolveApprovals(slots, approvals);
  return slots.some((s, i) => slotStatus[i]!.by === null && s.eligible.includes(cargo));
}

// ── Mapeamento dos campos do card → alçada/RICE ──────────────────────────────

export interface DemandComputed {
  alcada: RuleOutput;
  rice: number | null;
  /** Os 4 componentes do RICE estão preenchidos (score é calculável)? */
  riceComplete: boolean;
  /** Esforço calculado (Tempo + Complexidade + Orçamento) e suas parcelas. */
  effort: {
    total: number | null;
    tempoMeses: number | null;
    complexidade: number | null;
    orcamentoScore: number | null;
  };
  fields: {
    tipo: string | null;
    orcamento: number | null;
    area: string | null;
    urgencia: string | null;
    risco: string | null;
    isList: boolean;
  };
}

function titleCase(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s;
}

/**
 * Recalcula a alçada/RICE de um card a partir dos campos. Null se não for
 * demanda. `thresholds` vem da config do pipeline (board.alcada_thresholds).
 */
export function computeDemand(
  fields: FieldDef[],
  values: FieldValueRaw[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DemandComputed | null {
  const byName = new Map(fields.map((f) => [f.name, f]));
  if (!byName.has(DF.tipo)) return null; // pipeline sem os campos de demanda

  const valueOf = new Map(values.map((v) => [v.fieldId, v]));
  const raw = (name: string): FieldValueRaw | undefined => {
    const f = byName.get(name);
    return f ? valueOf.get(f.id) : undefined;
  };
  const optLabel = (name: string): string | null => {
    const f = byName.get(name);
    if (!f) return null;
    const v = valueOf.get(f.id);
    if (!v?.text) return null;
    return f.options.find((o) => o.id === v.text)?.label ?? null;
  };
  const num = (name: string): number | null => raw(name)?.number ?? null;
  const bool = (name: string): boolean => raw(name)?.bool ?? false;

  const tipoLabel = optLabel(DF.tipo);
  const alcada = evaluate({
    tipo: tipoLabel ? (titleCase(tipoLabel) as TipoDemanda) : null,
    orcamento: num(DF.orcamento),
    risco: optLabel(DF.risco) as RiskLevel | null,
    recorrente: bool(DF.recorrente),
    custoAnualizado: num(DF.custoAnual),
    fornecedorUnico: bool(DF.fornecedorUnico),
    foraDoOrcamento: bool(DF.foraOrcamento),
    reversibilidadeBaixa: bool(DF.reversibilidade),
    reclassificadoTransform: false,
    fracionamentoDetectado: bool(DF.fracionamento),
  }, thresholds);

  // Impacto e complexidade têm rótulo explicativo ("0,25 — Mínimo"): o score é
  // o número antes do travessão, em pt-BR.
  const impact = scoreFromLabel(optLabel(DF.riceImpacto));
  const reach = num(DF.riceAlcance);
  const confidence = num(DF.riceConfianca);

  // Esforço = Tempo + Complexidade + Orçamento. O score do orçamento sai do
  // valor já informado na demanda.
  const orcamentoScore = budgetEffortScore(num(DF.orcamento));
  const complexidade = scoreFromLabel(optLabel(DF.riceComplexidade));
  const effort = effortScore({ tempoMeses: num(DF.riceTempo), complexidade, orcamentoScore });

  const rice = riceScore({ reach, impact, confidence, effort });
  // Completo = os 4 são numéricos de verdade e o esforço é positivo.
  const riceComplete = rice != null;

  return {
    alcada,
    rice,
    riceComplete,
    effort: {
      total: effort,
      tempoMeses: num(DF.riceTempo),
      complexidade,
      orcamentoScore,
    },
    fields: {
      tipo: tipoLabel ? titleCase(tipoLabel) : null,
      orcamento: num(DF.orcamento),
      area: optLabel(DF.area),
      urgencia: optLabel(DF.urgencia),
      risco: optLabel(DF.risco),
      isList: bool(DF.isList),
    },
  };
}
