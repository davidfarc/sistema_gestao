// Cargos (organograma) — separado do papel de permissão. Os três primeiros são
// os que aprovam demandas (batem com ApproverRole do @ecco/core/alcadas).
export const CARGOS = [
  "Diretor Geral",
  "Diretor Administrativo",
  "Gestor Financeiro",
  "Coordenador",
  "Solicitante",
  "Estagiário",
] as const;

export type Cargo = (typeof CARGOS)[number];

/** Cargos que podem aparecer como aprovadores de alçada. */
export const APPROVER_CARGOS: readonly Cargo[] = [
  "Diretor Geral",
  "Diretor Administrativo",
  "Gestor Financeiro",
];
