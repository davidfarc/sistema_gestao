/**
 * Política de autorização ÚNICA. A UI só esconde por UX; é aqui (no servidor,
 * antes de qualquer escrita) que o acesso é de fato barrado. O banco reforça
 * com RLS (defesa em profundidade) — ver infra/policies.
 *
 * Modelo do PLANO.md:
 *  - INTERNO (e-mail no domínio da org): enxerga o board; ações conforme papéis.
 *  - EXTERNO: só enxerga um card se houver `assignment` dele naquele card.
 *  - Recurso não visível em LEITURA → NotFound (404), nunca 403 (não vaza existência).
 */

import type { Action, Actor } from "../domain/index.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors.js";

/** O ator tem a permissão de ação concedida por algum papel? */
export function can(actor: Actor, action: Action): boolean {
  return actor.permissions.has(action);
}

/**
 * O ator pode VER este card?
 * Interno: sempre (dentro da org). Externo: só se estiver atribuído.
 * `assignedUserIds` = ids de usuários com assignment no card.
 */
export function canSeeCard(
  actor: Actor,
  assignedUserIds: readonly string[],
): boolean {
  if (actor.isInternal) return true;
  return assignedUserIds.includes(actor.userId);
}

/**
 * Garante leitura do card ou lança NotFound (404) — mesma resposta para
 * "não existe" e "existe mas você não pode ver".
 */
export function assertCanSeeCard(
  actor: Actor,
  assignedUserIds: readonly string[],
): void {
  if (!canSeeCard(actor, assignedUserIds)) {
    throw new NotFoundError("Card não encontrado.");
  }
}

/**
 * Garante uma ação de ESCRITA/CONFIG. Pré-condição: o ator já pode ver o
 * recurso (senão, use assertCanSeeCard antes e deixe o 404 acontecer).
 */
export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) {
    throw new ForbiddenError(`Ação não permitida: ${action}.`);
  }
}

/** Garante que há um ator autenticado. */
export function assertAuthenticated(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError("Autenticação necessária.");
}
