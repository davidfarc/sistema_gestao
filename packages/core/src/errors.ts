/**
 * Erros de domínio. Cada porta de entrada (Server Action, REST, MCP) mapeia
 * `.status` para o protocolo dela. Regra de segurança do PLANO.md:
 * recurso não autorizado para LEITURA responde 404 (NotFound), nunca 403,
 * para não vazar a existência do recurso.
 */

export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  /** Detalhes seguros para expor ao cliente (não incluir dados sensíveis). */
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** Entrada inválida (falha de schema Zod, invariante de domínio violada). */
export class ValidationError extends DomainError {
  readonly status = 422;
  readonly code = "validation_error";
}

/** Recurso não existe — OU existe mas o ator não pode vê-lo (não vazamos qual). */
export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly code = "not_found";
}

/** Ator autenticado, recurso visível, mas a AÇÃO não é permitida. */
export class ForbiddenError extends DomainError {
  readonly status = 403;
  readonly code = "forbidden";
}

/** Não autenticado. */
export class UnauthorizedError extends DomainError {
  readonly status = 401;
  readonly code = "unauthorized";
}

/** Conflito de estado (posição concorrente, versão, unicidade). */
export class ConflictError extends DomainError {
  readonly status = 409;
  readonly code = "conflict";
}

/** Um gate de workflow (workflow_rule com enforcement=block) barrou a transição. */
export class GateBlockedError extends DomainError {
  readonly status = 409;
  readonly code = "gate_blocked";
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
