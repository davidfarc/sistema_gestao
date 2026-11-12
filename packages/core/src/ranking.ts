/**
 * Índice fracionário para ordenação de cards no Kanban/lista sem reescrever
 * a coluna inteira a cada arrasto. A coluna no Postgres é `numeric` (precisão
 * arbitrária), então o ponto-médio entre dois vizinhos nunca "acaba".
 *
 * - append no fim: `positionAfter(último)`
 * - inserir entre A e B: `positionBetween(A, B)`
 * - inserir no começo: `positionBefore(primeiro)`
 *
 * Escala pequena (≤ ~100 cards por coluna). Se algum dia a densidade de casas
 * decimais incomodar, `needsRebalance` sinaliza para renormalizar a coluna.
 */

export const POSITION_STEP = 1000;

/** Primeira posição de uma coluna vazia. */
export function firstPosition(): number {
  return POSITION_STEP;
}

/** Posição imediatamente depois de `pos` (append no fim da coluna). */
export function positionAfter(pos: number): number {
  return pos + POSITION_STEP;
}

/** Posição imediatamente antes de `pos` (insere no topo da coluna). */
export function positionBefore(pos: number): number {
  return pos / 2;
}

/**
 * Posição entre dois vizinhos. Passe `null` quando não houver vizinho daquele
 * lado (topo ou fundo da coluna).
 */
export function positionBetween(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) return firstPosition();
  if (before === null) return positionBefore(after!);
  if (after === null) return positionAfter(before);
  if (before >= after) {
    throw new RangeError(
      `positionBetween: 'before' (${before}) deve ser menor que 'after' (${after})`,
    );
  }
  return (before + after) / 2;
}

/**
 * Heurística para decidir renormalizar: se o gap entre vizinhos ficou tão
 * pequeno que o ponto-médio não é mais distinguível em ponto-flutuante.
 */
export function needsRebalance(before: number, after: number): boolean {
  const mid = (before + after) / 2;
  return mid <= before || mid >= after;
}

/** Reatribui posições igualmente espaçadas preservando a ordem atual. */
export function rebalance(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_STEP);
}

// ── Soltar um card numa posição da coluna ───────────────────────────────────

/**
 * Onde o card foi solto, descrito pelos vizinhos que a pessoa VIA na tela:
 * `beforeId` é o card logo acima, `afterId` o logo abaixo (null = não há).
 * Com busca/filtro ligados os vizinhos visíveis podem não ser os vizinhos
 * reais da coluna; por isso a posição é resolvida contra a coluna inteira.
 */
export interface Placement {
  beforeId: string | null;
  afterId: string | null;
}

export interface Positioned {
  id: string;
  position: number;
}

export type PlacementResult =
  /** Basta gravar a posição do card movido. */
  | { kind: "single"; position: number }
  /** Sem espaço entre os vizinhos: regrava a coluna inteira, já com o card. */
  | { kind: "rebalance"; positions: Positioned[] };

/**
 * Índice em que o card entra na coluna (já sem ele): logo depois de
 * `beforeId`; se ele não estiver na coluna, logo antes de `afterId`; se nenhum
 * dos dois estiver, no fim.
 */
export function placementIndex(columnIds: readonly string[], placement: Placement): number {
  const before = placement.beforeId ? columnIds.indexOf(placement.beforeId) : -1;
  if (before >= 0) return before + 1;
  const after = placement.afterId ? columnIds.indexOf(placement.afterId) : -1;
  if (after >= 0) return after;
  return columnIds.length;
}

/**
 * Calcula a posição de `movedId` ao ser solto em `placement`. `column` é a
 * coluna de destino na ordem atual (pode ou não conter o próprio card).
 *
 * No caso comum devolve uma posição só (ponto médio entre os vizinhos). Quando
 * os vizinhos têm a mesma posição (cards antigos nasceram todos com 1000) ou o
 * intervalo se esgotou, devolve a coluna inteira renumerada.
 */
export function placeInColumn(
  column: readonly Positioned[],
  movedId: string,
  placement: Placement,
): PlacementResult {
  const rest = column.filter((c) => c.id !== movedId);
  const index = placementIndex(
    rest.map((c) => c.id),
    placement,
  );
  const prev = rest[index - 1] ?? null;
  const next = rest[index] ?? null;

  if (!prev || !next || prev.position < next.position) {
    const position = positionBetween(prev?.position ?? null, next?.position ?? null);
    const fits =
      Number.isFinite(position) &&
      position > 0 &&
      (!prev || position > prev.position) &&
      (!next || position < next.position);
    if (fits) return { kind: "single", position };
  }

  const ids = [...rest.slice(0, index).map((c) => c.id), movedId, ...rest.slice(index).map((c) => c.id)];
  const spaced = rebalance(ids.length);
  return { kind: "rebalance", positions: ids.map((id, i) => ({ id, position: spaced[i]! })) };
}
