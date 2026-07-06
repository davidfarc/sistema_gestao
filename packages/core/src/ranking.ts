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
