/**
 * Tipos de domínio. Reflete o modelo de dados do PLANO.md.
 *
 * Regra: só vira união literal (enum de tipo) o que é REALMENTE fixo no produto
 * (ex.: enforcement de gate). O que o gestor configura — etapas (stage), papéis,
 * campos customizados, matérias, séries — é DADO em tabela, nunca enum.
 */

import type {
  AssignmentId,
  AttachmentId,
  BoardId,
  CardId,
  ChannelId,
  ChecklistId,
  CommentId,
  EmendaId,
  FieldDefinitionId,
  MessageId,
  OrganizationId,
  RoleId,
  StageId,
  TeamId,
  UserId,
  VolumeId,
  WorkflowRuleId,
} from "../ids.js";

/** Campos comuns a toda entidade persistida. */
export interface Entity {
  organizationId: OrganizationId;
  createdAt: string; // ISO-8601
  updatedAt: string;
  archivedAt: string | null; // soft-delete
}

// ────────────────────────────────────────────────────────────────────────────
// Ator (contexto autenticado) — o que a política de autorização recebe.
// ────────────────────────────────────────────────────────────────────────────

/** Ações do sistema. Papéis (role) concedem um conjunto delas (data-driven). */
export type Action =
  | "board:read"
  | "board:configure" // etapas, campos, workflow-rules, papéis
  | "card:read"
  | "card:create"
  | "card:update"
  | "card:move"
  | "card:assign"
  | "comment:create"
  | "channel:read"
  | "channel:post"
  | "field:manage"
  | "workflow:manage";

export interface Actor {
  userId: UserId;
  organizationId: OrganizationId;
  /** interno = e-mail no domínio da organização. Externos entram só por assignment. */
  isInternal: boolean;
  /** Ações concedidas pelos papéis do usuário (resolvidas). */
  permissions: ReadonlySet<Action>;
  teamIds: readonly TeamId[];
}

// ────────────────────────────────────────────────────────────────────────────
// Taxonomia (entidades configuráveis — nunca hardcode)
// ────────────────────────────────────────────────────────────────────────────

export interface Segmento extends Entity {
  id: string;
  code: string; // "FUND2"
  name: string; // "Fundamental 2"
  position: number;
}

export interface Serie extends Entity {
  id: string;
  segmentoId: string;
  code: string; // "7A"
  name: string; // "7º ano"
  position: number;
}

export interface Materia extends Entity {
  id: string;
  code: string; // "TEX" = Produção de Texto
  name: string;
  position: number;
}

/** Bimestre 1–4; 0 = anual (volume único, ex.: Artes). */
export interface Bimestre {
  number: 0 | 1 | 2 | 3 | 4;
}

export interface AnoLetivo extends Entity {
  id: string;
  year: number; // 2027
}

// ────────────────────────────────────────────────────────────────────────────
// Quadro & pipeline
// ────────────────────────────────────────────────────────────────────────────

/** Categoria da coluna (agrupamento visual — não é o gate). */
export type StageCategory = "backlog" | "in_progress" | "review" | "done";

export interface Stage extends Entity {
  id: StageId;
  boardId: BoardId;
  name: string;
  position: number;
  category: StageCategory;
  wipLimit: number | null;
}

/** Quais propriedades aparecem na face do card (config por quadro). */
export interface CardFaceConfig {
  showAssignee: boolean;
  showDueDate: boolean;
  showLabels: boolean;
  fieldDefinitionIds: FieldDefinitionId[];
}

export interface Board extends Entity {
  id: BoardId;
  name: string;
  anoLetivoId: string;
  segmentoId: string | null; // quadro por safra/segmento
  cardFaceConfig: CardFaceConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// Card — unidade matéria × série × bimestre
// ────────────────────────────────────────────────────────────────────────────

export type CardStatus = "active" | "blocked" | "done" | "archived";

export interface Card extends Entity {
  id: CardId;
  boardId: BoardId;
  /** Código gerado da taxonomia: TEX-7A-FUND2-1B-2027 (denormalizado p/ busca). */
  code: string;
  title: string;
  // FKs de taxonomia denormalizadas (filtro/relatório indexado)
  materiaId: string;
  serieId: string;
  segmentoId: string;
  bimestre: Bimestre["number"];
  anoLetivoId: string;
  // pipeline
  stageId: StageId;
  stageEnteredAt: string; // p/ cycle-time
  position: number; // índice fracionário (ranking.ts)
  priority: number;
  dueDate: string | null;
  status: CardStatus;
}

// ────────────────────────────────────────────────────────────────────────────
// Volume (agregação M:N — modelado, fora da UI do MVP)
// ────────────────────────────────────────────────────────────────────────────

export type PrinterStatus = "pending" | "sent" | "printing" | "delivered";

export interface Volume extends Entity {
  id: VolumeId;
  serieId: string;
  bimestre: Bimestre["number"];
  name: string;
  isbn: string | null;
  printerStatus: PrinterStatus;
}

/** Junção configurável card↔volume (a regra de agregação varia por segmento). */
export interface VolumeCard {
  volumeId: VolumeId;
  cardId: CardId;
  position: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Campos customizados (tabela tipada — não JSONB puro)
// ────────────────────────────────────────────────────────────────────────────

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "select" // single
  | "multi_select"
  | "checkbox"
  | "member"
  | "link"
  | "status";

export interface FieldOption {
  id: string;
  label: string;
  color: string | null;
}

export interface FieldDefinition extends Entity {
  id: FieldDefinitionId;
  boardId: BoardId;
  name: string;
  type: FieldType;
  /** opções (select/status), formato, etc. */
  config: { options?: FieldOption[] } & Record<string, unknown>;
  showOnCardFace: boolean;
  isFilterable: boolean;
  position: number;
}

/** Valor tipado (colunas dedicadas + value_json para multi-select). */
export interface FieldValue {
  fieldDefinitionId: FieldDefinitionId;
  cardId: CardId;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueMemberId: UserId | null;
  valueJson: unknown | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Checklists / anexos / emendas
// ────────────────────────────────────────────────────────────────────────────

export interface Checklist extends Entity {
  id: ChecklistId;
  cardId: CardId;
  name: string;
  position: number;
}

export interface ChecklistItem {
  id: string;
  checklistId: ChecklistId;
  text: string;
  done: boolean;
  assigneeId: UserId | null; // espelha "Revisão [pessoa]" / "Feito por [pessoa]"
  position: number;
}

export type AttachmentKind = "drive_link" | "emenda";

export interface Attachment extends Entity {
  id: AttachmentId;
  cardId: CardId;
  kind: AttachmentKind;
  label: string;
  url: string; // link do Google Drive
}

export type EmendaStatus =
  | "aberta"
  | "em_revisao"
  | "enviada_autor"
  | "enviada_diagramacao"
  | "concluida";

export interface Emenda extends Entity {
  id: EmendaId;
  cardId: CardId;
  round: number; // 1ª emenda, 2ª emenda...
  status: EmendaStatus;
  driveUrl: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Comunicação
// ────────────────────────────────────────────────────────────────────────────

export interface Comment extends Entity {
  id: CommentId;
  cardId: CardId;
  authorId: UserId;
  body: string;
  mentions: UserId[];
  parentId: CommentId | null; // thread
}

export interface Channel extends Entity {
  id: ChannelId;
  name: string;
  teamId: TeamId | null; // canal por equipe/projeto
}

export interface ChannelMember {
  channelId: ChannelId;
  userId: UserId;
  lastReadAt: string | null;
}

export interface Message extends Entity {
  id: MessageId;
  channelId: ChannelId;
  authorId: UserId;
  body: string;
  mentions: UserId[]; // mesma forma do Comment → parser/render compartilhados
}

// ────────────────────────────────────────────────────────────────────────────
// Acesso & pessoas
// ────────────────────────────────────────────────────────────────────────────

export interface Team extends Entity {
  id: TeamId;
  name: string; // raia do BPMN (Diagramação, Revisor externo, ...)
}

export interface Role extends Entity {
  id: RoleId;
  name: string;
  permissions: Action[]; // data-driven (jsonb no banco)
}

export interface User extends Entity {
  id: UserId;
  email: string;
  name: string;
  isInternal: boolean; // domínio == organização
  avatarUrl: string | null;
}

/** A linha que dá ESCOPO ao externo: card ↔ user ↔ (opcional) stage. */
export interface Assignment extends Entity {
  id: AssignmentId;
  cardId: CardId;
  userId: UserId;
  stageId: StageId | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Workflow & auditoria
// ────────────────────────────────────────────────────────────────────────────

/** O que uma regra exige para permitir a transição. */
export type RequirementKind =
  | "checklist_complete"
  | "attachment_present"
  | "field_filled"
  | "emenda_concluded"
  | "approval"
  | "role";

export type Enforcement = "block" | "warn";

export interface WorkflowRule extends Entity {
  id: WorkflowRuleId;
  boardId: BoardId;
  fromStageId: StageId | null; // null = qualquer origem
  toStageId: StageId;
  requirement: RequirementKind;
  /** parâmetro da regra (ex.: fieldDefinitionId, roleId, checklistId). */
  requirementConfig: Record<string, unknown>;
  enforcement: Enforcement;
  isActive: boolean;
}

export type ActivityKind =
  | "card_created"
  | "card_moved"
  | "card_updated"
  | "gate_overridden"
  | "comment_posted"
  | "assignment_changed"
  | "emenda_updated";

/** Feed + auditoria append-only. */
export interface Activity {
  id: string;
  organizationId: OrganizationId;
  cardId: CardId | null;
  actorId: UserId;
  kind: ActivityKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Notification {
  id: string;
  organizationId: OrganizationId;
  userId: UserId;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Geração de código do card a partir da taxonomia
// ────────────────────────────────────────────────────────────────────────────

/** TEX-7A-FUND2-1B-2027. Bimestre 0 (anual) vira "ANUAL". */
export function buildCardCode(parts: {
  materiaCode: string;
  serieCode: string;
  segmentoCode: string;
  bimestre: Bimestre["number"];
  year: number;
}): string {
  const bim = parts.bimestre === 0 ? "ANUAL" : `${parts.bimestre}B`;
  return [
    parts.materiaCode,
    parts.serieCode,
    parts.segmentoCode,
    bim,
    String(parts.year),
  ].join("-");
}
