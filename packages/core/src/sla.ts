// Prazo (SLA) por urgência, em DIAS ÚTEIS. Portado de eccoprime-demandas
// (src/lib/sla.ts) — lógica pura, sem dependência de banco.
//
// A urgência é comparada por trecho do rótulo porque os textos trazem a faixa
// junto ("Alta (até 7 dias)"). A ordem dos testes importa: "muito alta" contém
// "alta", e "muito baixa" contém "baixa".

export type SlaLevel = "muito_alta" | "alta" | "normal" | "baixa" | "muito_baixa";

const LIMITS: Record<SlaLevel, number> = {
  muito_alta: 2,
  alta: 7,
  normal: 30,
  baixa: 90,
  muito_baixa: 180,
};

/** Classifica o rótulo de urgência. Sem urgência definida ⇒ normal. */
export function slaLevelOf(urgencia: string | null | undefined): SlaLevel {
  const u = (urgencia ?? "").toLowerCase();
  if (u.includes("muito alta") || u.includes("emergencial")) return "muito_alta";
  if (u.includes("alta")) return "alta";
  if (u.includes("muito baixa")) return "muito_baixa";
  if (u.includes("baixa")) return "baixa";
  return "normal";
}

/** Prazo em dias úteis para a urgência. */
export function slaLimitDays(urgencia: string | null | undefined): number {
  return LIMITS[slaLevelOf(urgencia)];
}

/**
 * Converte para o INÍCIO DO DIA LOCAL.
 *
 * Cuidado com fuso: `new Date("2026-07-10")` é meia-noite UTC, e no Brasil
 * (UTC-3) isso já é dia 9 no horário local — o prazo sairia um dia errado.
 * Datas puras (YYYY-MM-DD) são montadas como locais; timestamps completos
 * (created_at do card) são instantes reais e podem ser convertidos direto.
 */
function startOfLocalDay(value: Date | string): Date {
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Dias úteis entre duas datas (exclui sábados e domingos; fim exclusivo). */
export function businessDaysBetween(start: Date | string, end: Date | string): number {
  const cur = startOfLocalDay(start);
  const to = startOfLocalDay(end);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(to.getTime())) return 0;

  let count = 0;
  while (cur < to) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export interface SlaStatus {
  limitDays: number;
  elapsedDays: number;
  /** Negativo quando estourou o prazo. */
  remainingDays: number;
  late: boolean;
  /** 0–1 do prazo consumido (satura em 1 quando atrasado). */
  progress: number;
}

/** Situação do prazo de uma demanda aberta em `startedAt`. */
export function slaStatus(
  urgencia: string | null | undefined,
  startedAt: Date | string,
  now: Date | string = new Date(),
): SlaStatus {
  const limitDays = slaLimitDays(urgencia);
  const elapsedDays = businessDaysBetween(startedAt, now);
  const remainingDays = limitDays - elapsedDays;
  return {
    limitDays,
    elapsedDays,
    remainingDays,
    late: remainingDays < 0,
    progress: limitDays <= 0 ? 1 : Math.min(1, elapsedDays / limitDays),
  };
}
