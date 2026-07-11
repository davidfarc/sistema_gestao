// Motor de alçadas (matriz de aprovação por faixa) + score RICE.
// Portado de eccoprime-demandas (src/lib/alcadas/rules.ts) — lógica PURA, sem
// dependência de banco. Usado pelo formulário personalizado "Demandas de compras".
//
// Fluxo do evaluate:
//   1. Baseline por valor (A/B/C)
//   2. Transform → sempre Faixa C (hard)
//   3. Grow com orçamento > limiteGrow → C (hard)
//   4. Recorrência com custo anualizado > limiteAnualRecorrencia → C (hard)
//   5. Reclassificação Transform → C (hard)
//   6. Cada gatilho ativo eleva UMA faixa (A→B, B→C)

export type TipoDemanda = "Run" | "Keep" | "Grow" | "Transform";
export type Bracket = "A" | "B" | "C";
export type Track = "rapida" | "padrao" | "projeto";
export type RiskLevel = "Muito baixo" | "Baixo" | "Moderado" | "Alto" | "Muito alto";
export type ApproverRole = "Gestor Financeiro" | "Diretor Administrativo" | "Diretor Geral";

export interface Approver {
  role: ApproverRole;
  or?: ApproverRole[]; // qualquer um dos papéis pode aprovar
}

export type TriggerKind =
  | "transform"
  | "grow_gt_5k"
  | "valor_gt_24k_ano"
  | "risco_alto"
  | "fornecedor_unico"
  | "recorrencia_isolada"
  | "reclassif_transform"
  | "fora_orcamento"
  | "reversibilidade_baixa"
  | "anti_fracionamento";

export interface Trigger {
  kind: TriggerKind;
  message: string;
  effect: "hard" | "step";
}

export interface RuleInput {
  tipo: TipoDemanda | null;
  orcamento: number | null;
  risco: RiskLevel | null;
  recorrente: boolean;
  custoAnualizado?: number | null;
  fornecedorUnico: boolean;
  foraDoOrcamento: boolean;
  reversibilidadeBaixa: boolean;
  reclassificadoTransform: boolean;
  fracionamentoDetectado: boolean;
}

export interface RuleOutput {
  bracket: Bracket;
  track: Track;
  approvers: Approver[];
  triggers: Trigger[];
  slaDias: { min: number; max: number };
  requiresEvidences: boolean;
  minCotacoes: 0 | 3;
}

export interface Thresholds {
  limiteFaixaA: number;
  limiteFaixaB: number;
  limiteGrow: number;
  limiteAnualRecorrencia: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  limiteFaixaA: 2000,
  limiteFaixaB: 10000,
  limiteGrow: 5000,
  limiteAnualRecorrencia: 24000,
};

const APPROVERS_RAPIDA: Approver[] = [{ role: "Gestor Financeiro", or: ["Diretor Administrativo"] }];
const APPROVERS_PADRAO: Approver[] = [
  { role: "Gestor Financeiro" },
  { role: "Diretor Administrativo" },
];
const APPROVERS_PROJETO: Approver[] = [{ role: "Diretor Geral" }];

const SLA_RAPIDA = { min: 1, max: 2 };
const SLA_PADRAO = { min: 3, max: 5 };
const SLA_PROJETO = { min: 5, max: 10 };

function baselineByValue(orcamento: number | null, t: Thresholds): Bracket {
  const v = orcamento ?? 0;
  if (v <= t.limiteFaixaA) return "A";
  if (v <= t.limiteFaixaB) return "B";
  return "C";
}

function bracketToTrack(b: Bracket): Track {
  return b === "A" ? "rapida" : b === "B" ? "padrao" : "projeto";
}

function trackApprovers(t: Track): Approver[] {
  return t === "rapida" ? APPROVERS_RAPIDA : t === "padrao" ? APPROVERS_PADRAO : APPROVERS_PROJETO;
}

function trackSla(t: Track) {
  return t === "rapida" ? SLA_RAPIDA : t === "padrao" ? SLA_PADRAO : SLA_PROJETO;
}

function stepUp(b: Bracket): Bracket {
  return b === "A" ? "B" : "C";
}

export function evaluate(input: RuleInput, thresholds: Thresholds = DEFAULT_THRESHOLDS): RuleOutput {
  const triggers: Trigger[] = [];
  let bracket = baselineByValue(input.orcamento, thresholds);

  if (input.tipo === "Transform") {
    triggers.push({ kind: "transform", message: "Demanda Transform sempre passa por Direção Geral.", effect: "hard" });
    bracket = "C";
  }
  if (input.tipo === "Grow" && (input.orcamento ?? 0) > thresholds.limiteGrow) {
    triggers.push({
      kind: "grow_gt_5k",
      message: `Grow acima de R$${thresholds.limiteGrow.toLocaleString("pt-BR")} vai para Direção Geral.`,
      effect: "hard",
    });
    bracket = "C";
  }
  if (input.recorrente && (input.custoAnualizado ?? 0) > thresholds.limiteAnualRecorrencia) {
    triggers.push({
      kind: "valor_gt_24k_ano",
      message: `Recorrência somando mais de R$${thresholds.limiteAnualRecorrencia.toLocaleString("pt-BR")}/ano vira decisão de Direção Geral.`,
      effect: "hard",
    });
    bracket = "C";
  }
  if (input.reclassificadoTransform) {
    triggers.push({ kind: "reclassif_transform", message: "Reclassificação para Transform: precisa de Direção Geral.", effect: "hard" });
    bracket = "C";
  }

  const isRiskHigh = input.risco === "Alto" || input.risco === "Muito alto";
  if (isRiskHigh) {
    triggers.push({ kind: "risco_alto", message: `Risco ${input.risco}: eleva uma faixa.`, effect: "step" });
    bracket = stepUp(bracket);
  }
  if (input.fornecedorUnico) {
    triggers.push({ kind: "fornecedor_unico", message: "Fornecedor único / dispensa de cotação: eleva uma faixa.", effect: "step" });
    bracket = stepUp(bracket);
  }
  if (input.recorrente && !triggers.some((t) => t.kind === "valor_gt_24k_ano")) {
    triggers.push({ kind: "recorrencia_isolada", message: "Compra recorrente: eleva uma faixa (mesmo abaixo do limite anual).", effect: "step" });
    bracket = stepUp(bracket);
  }
  if (input.foraDoOrcamento) {
    triggers.push({ kind: "fora_orcamento", message: "Fora do orçamento planejado: eleva uma faixa.", effect: "step" });
    bracket = stepUp(bracket);
  }
  if (input.reversibilidadeBaixa) {
    triggers.push({ kind: "reversibilidade_baixa", message: "Decisão difícil de reverter: eleva uma faixa.", effect: "step" });
    bracket = stepUp(bracket);
  }
  if (input.fracionamentoDetectado) {
    triggers.push({
      kind: "anti_fracionamento",
      message: "Compras similares nos últimos 30 dias já ultrapassam o limite: eleva uma faixa e vira decisão única.",
      effect: "step",
    });
    bracket = stepUp(bracket);
  }

  const track = bracketToTrack(bracket);
  const requiresEvidences = bracket !== "A";
  return {
    bracket,
    track,
    approvers: trackApprovers(track),
    triggers,
    slaDias: trackSla(track),
    requiresEvidences,
    minCotacoes: requiresEvidences ? 3 : 0,
  };
}

export const TRACK_LABEL: Record<Track, string> = {
  rapida: "Trilha rápida",
  padrao: "Trilha padrão (comitê)",
  projeto: "Trilha projeto (Direção Geral)",
};

export const BRACKET_LABEL: Record<Bracket, string> = {
  A: "Faixa A",
  B: "Faixa B",
  C: "Faixa C",
};

/**
 * Score RICE = (Reach × Impact × Confiança%) / Esforço. Null se faltar algum
 * input ou esforço <= 0. Impact é o multiplicador (0,25…2); Confiança em 0–100.
 */
export function riceScore(input: {
  reach?: number | null;
  impact?: number | null;
  confidence?: number | null;
  effort?: number | null;
}): number | null {
  const { reach, impact, confidence, effort } = input;
  if (reach == null || impact == null || confidence == null || effort == null) return null;
  if (effort <= 0) return null;
  return (reach * impact * (confidence / 100)) / effort;
}
