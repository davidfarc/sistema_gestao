/**
 * Ports = interfaces que o núcleo consome. O `core` NÃO conhece Supabase;
 * `packages/adapters/supabase` implementa estas interfaces. Trocar de banco
 * (ou integrar o Firebase existente) = escrever outro adaptador, sem tocar no core.
 */

import type {
  Assignment,
  Board,
  Card,
  Checklist,
  ChecklistItem,
  Emenda,
  FieldValue,
  Stage,
  WorkflowRule,
} from "../domain/index.js";
import type { BoardId, CardId, StageId, UserId } from "../ids.js";

// ── Infra ────────────────────────────────────────────────────────────────────

/** Relógio injetável (testes determinísticos; nada de `new Date()` espalhado). */
export interface Clock {
  now(): Date;
  nowIso(): string;
}

/** Geração de ids (uuid) — injetável para testes. */
export interface IdGenerator {
  uuid(): string;
}

/** Publica eventos de domínio (auditoria, realtime, notificações). */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

export interface DomainEvent {
  kind: string;
  organizationId: string;
  actorId: UserId;
  cardId?: CardId;
  payload: Record<string, unknown>;
}

// ── Repositórios ──────────────────────────────────────────────────────────────

export interface BoardRepository {
  findById(id: BoardId): Promise<Board | null>;
}

export interface StageRepository {
  findById(id: StageId): Promise<Stage | null>;
  listByBoard(boardId: BoardId): Promise<Stage[]>;
}

export interface CardRepository {
  findById(id: CardId): Promise<Card | null>;
  create(card: Card): Promise<Card>;
  update(id: CardId, patch: Partial<Card>): Promise<Card>;
  /** Última posição usada numa etapa (para append no fim da coluna). */
  maxPositionInStage(stageId: StageId): Promise<number | null>;
}

export interface AssignmentRepository {
  listByCard(cardId: CardId): Promise<Assignment[]>;
  existsForUserOnCard(userId: UserId, cardId: CardId): Promise<boolean>;
}

export interface WorkflowRuleRepository {
  /** Regras ativas que se aplicam à transição from→to (from=null casa qualquer origem). */
  listForTransition(
    boardId: BoardId,
    fromStageId: StageId,
    toStageId: StageId,
  ): Promise<WorkflowRule[]>;
}

/** Dados usados para avaliar os requisitos dos gates de um card. */
export interface CardStateReader {
  listChecklists(cardId: CardId): Promise<Checklist[]>;
  listChecklistItems(cardId: CardId): Promise<ChecklistItem[]>;
  listFieldValues(cardId: CardId): Promise<FieldValue[]>;
  listEmendas(cardId: CardId): Promise<Emenda[]>;
  hasAttachment(cardId: CardId): Promise<boolean>;
}
