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

const THRESHOLD_KEYS = [
  "limiteFaixaA",
  "limiteFaixaB",
  "limiteGrow",
  "limiteAnualRecorrencia",
] as const;

/**
 * Converte a config crua (jsonb do board, formulário, etc.) em Thresholds,
 * caindo no default POR CHAVE quando o valor é ausente ou inválido. jsonb pode
 * devolver string; sem a coerção, o `toLocaleString` das mensagens dos gatilhos
 * quebraria. `{}` ⇒ DEFAULT_THRESHOLDS.
 */
export function parseThresholds(raw: unknown): Thresholds {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_THRESHOLDS };
  if (typeof src !== "object") return out;
  for (const key of THRESHOLD_KEYS) {
    const n = Number(src[key]);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/** Valida limites antes de salvar. Retorna a mensagem de erro, ou null se ok. */
export function validateThresholds(t: Thresholds): string | null {
  for (const key of THRESHOLD_KEYS) {
    const v = t[key];
    if (!Number.isFinite(v) || v <= 0) return "Os limites devem ser valores positivos.";
    if (!Number.isInteger(v)) return "Os limites devem ser números inteiros (sem centavos).";
  }
  if (t.limiteFaixaA >= t.limiteFaixaB) {
    return "O limite da Faixa A deve ser menor que o da Faixa B.";
  }
  return null;
}

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
 * Converte texto em número aceitando vírgula decimal ("0,25" ⇒ 0.25).
 * Os rótulos de impacto são escritos em pt-BR; `Number("0,25")` daria NaN.
 * Null quando vazio ou não numérico.
 */
export function parseDecimal(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = value.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrai o score de um rótulo que começa com o número e explica o significado
 * ("0,25 — Mínimo", "3 — Múltiplas áreas…"). Sem o corte no travessão,
 * `parseDecimal` receberia o texto inteiro e devolveria null.
 */
export function scoreFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const head = label.split(/[—–-]/)[0] ?? label;
  return parseDecimal(head);
}

// ── Esforço do RICE (manual de boas práticas de Compras/Demandas) ────────────
//
// Effort = Tempo + Complexidade + Orçamento. É SOMA — confirmado pelo exemplo do
// manual (telhado: 2 + 4 + 2 = 8). Cada parcela tem sua tabela.

/**
 * Score do orçamento: até R$10k = 1, R$10k–50k = 2, acima de R$50k = 3.
 * Derivado do valor já informado na demanda — não se digita de novo.
 *
 * ⚠️ O manual tem uma divergência: a tabela dá 3 para "acima de 50k", mas o
 * exemplo pontua R$73k como 2. Seguimos a tabela (ela é a definição).
 */
export function budgetEffortScore(orcamento: number | null | undefined): number | null {
  if (!Number.isFinite(orcamento)) return null;
  const v = orcamento as number;
  if (v <= 10_000) return 1;
  if (v <= 50_000) return 2;
  return 3;
}

/** Níveis de complexidade (1–4) com a descrição de cada um. */
export const COMPLEXITY_LEVELS: { score: 1 | 2 | 3 | 4; label: string }[] = [
  { score: 1, label: "Compra direta: 1 responsável, sem validação técnica, 1 fornecedor" },
  { score: 2, label: "Envolve 2–3 pessoas/áreas OU cotação simples OU validação leve" },
  { score: 3, label: "Múltiplas áreas + critérios técnicos + negociação + comparação estruturada" },
  {
    score: 4,
    label: "Contrato/renovação, múltiplos aprovadores críticos, dependência externa, escopo móvel",
  },
];

/**
 * Esforço = Tempo (meses) + Complexidade (1–4) + Orçamento (1–3).
 * Null se faltar alguma parcela — sem isso o RICE não fecha.
 */
export function effortScore(input: {
  tempoMeses?: number | null;
  complexidade?: number | null;
  orcamentoScore?: number | null;
}): number | null {
  const { tempoMeses, complexidade, orcamentoScore } = input;
  if (![tempoMeses, complexidade, orcamentoScore].every((v) => Number.isFinite(v))) return null;
  return tempoMeses! + complexidade! + orcamentoScore!;
}

/**
 * Score RICE = (Reach × Impact × Confiança%) / Esforço. Null se faltar algum
 * input, se algum não for numérico, ou se o esforço for <= 0. Impact é o
 * multiplicador (0,25…2); Confiança em 0–100.
 */
export function riceScore(input: {
  reach?: number | null;
  impact?: number | null;
  confidence?: number | null;
  effort?: number | null;
}): number | null {
  const { reach, impact, confidence, effort } = input;
  // `Number.isFinite` (e não `!= null`) para barrar NaN vindo de texto inválido —
  // sem isso o NaN se propaga e a tela mostra "NaN".
  if (![reach, impact, confidence, effort].every((v) => Number.isFinite(v))) return null;
  if (effort! <= 0) return null;
  return (reach! * impact! * (confidence! / 100)) / effort!;
}
