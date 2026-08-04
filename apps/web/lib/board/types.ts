/**
 * View-models da UI do quadro. Leves e desacoplados da persistência.
 * O card é identificado pela numeração (#number) + título — sem taxonomia.
 */

import type { Thresholds } from "@ecco/core";

/**
 * Último pipeline aberto. Cookie (não localStorage) para o servidor já
 * renderizar o quadro certo — sem abrir no errado e corrigir depois.
 */
export const LAST_BOARD_COOKIE = "ecco_ultimo_quadro";

export interface Member {
  id: string;
  name: string;
  initials: string;
  colorClass: string; // classes Tailwind do avatar
}

export interface Label {
  text: string;
  colorClass: string;
}

/** Valor de um "Status" (campo customizado tipo select) — futuro. */
export interface StatusValue {
  label: string;
  colorClass: string;
}

export interface CardView {
  id: string;
  number: number; // ID sequencial por quadro (#1, #2…)
  title: string;
  stageId: string;
  assignee: Member | null;
  /** Quem pediu (nativo, ao lado do responsável). Preenchido na criação. */
  requester: Member | null;
  labels: Label[];
  dueDate: string | null; // ISO
  status: StatusValue | null;
  fields: FieldChip[]; // campos customizados marcados "mostrar no card"
  /** Está numa etapa cuja saída exige priorização (e ainda não foi priorizada). */
  awaitingPrioritization?: boolean;
}

// ── Propriedades customizadas (campos) ──────────────────────────────────────

export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "member"
  | "link"
  | "status";

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  showOnCardFace: boolean;
  showOnCreate: boolean; // pedir este campo no formulário de criação (genérico)
  isRequired: boolean; // obrigatório no formulário de criação
  position: number;
  global: boolean; // true = aparece em todos os pipelines (board_id nulo)
  /**
   * Alçada da propriedade: ids de quem pode editá-la. Vazio = qualquer um que
   * possa editar o card. Ex.: só a coordenação marca o checkbox "Aprovado".
   */
  allowedEditors: string[];
}

/** Quem pode editar esta propriedade? Lista vazia = todos. */
export function canEditField(field: FieldDef, userId: string | null | undefined): boolean {
  if (field.allowedEditors.length === 0) return true;
  return !!userId && field.allowedEditors.includes(userId);
}

/** Modo do formulário de criação de um pipeline. */
export type CreationForm = "simple" | "generic" | `custom:${string}`;

/**
 * Quem pode abrir o formulário de criação de um pipeline.
 * - `members`: só quem tem acesso ao pipeline (padrão, comportamento histórico)
 * - `org`: qualquer pessoa interna da organização, mesmo sem ver o quadro
 * - `users`: apenas as pessoas nomeadas
 *
 * Serve ao caso de quem pede algo a outra área — o gestor pedagógico abrindo
 * uma demanda para TI — sem lhe dar visibilidade do pipeline inteiro: quem
 * entra por aqui enxerga somente as próprias solicitações.
 */
export type Intake = "members" | "org" | "users";

/** Interpreta a coluna `board.intake`, caindo no padrão fechado. */
export function parseIntake(raw: unknown): Intake {
  return raw === "org" || raw === "users" ? raw : "members";
}

/** Valor bruto de um campo num card (colunas tipadas). */
export interface FieldValueRaw {
  fieldId: string;
  text: string | null;
  number: number | null;
  date: string | null;
  bool: boolean | null;
  memberId: string | null;
}

/** Valor resolvido para exibir na face do card / lista. */
export interface FieldChip {
  fieldId: string;
  name: string;
  type: FieldType;
  display: string;
  color: string | null;
}

export type StageCategory = "backlog" | "in_progress" | "review" | "done";

export interface StageView {
  id: string;
  name: string;
  category: StageCategory;
}

export interface BoardData {
  id: string;
  name: string;
  creationForm: CreationForm;
  /** Limites de alçada do pipeline (já mesclados com os defaults do core). */
  alcadaThresholds: Thresholds;
  /** Quem pode abrir o formulário de criação deste pipeline. */
  intake: Intake;
  stages: StageView[];
  cards: CardView[];
  members: Member[];
}

/** Item do seletor de pipelines. */
export interface BoardSummary {
  id: string;
  name: string;
  archived: boolean;
}

export interface ChecklistItemView {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface ChecklistView {
  id: string;
  name: string;
  position: number;
  items: ChecklistItemView[];
}

export interface AttachmentView {
  id: string;
  label: string;
  url: string;
}

export interface ActivityView {
  id: string;
  kind: string;
  actorName: string;
  createdAt: string; // ISO
  payload: Record<string, unknown>;
}

export interface CommentView {
  id: string;
  authorName: string;
  body: string;
  createdAt: string; // ISO
  isOwn: boolean;
}

export interface MemberOption {
  id: string;
  name: string;
}

export interface ChannelView {
  id: string;
  name: string;
}

/** Item da lista de conversas (estilo WhatsApp): canal de grupo ou DM 1:1. */
export interface ConversationView {
  id: string;
  kind: "group" | "dm";
  /** Nome do grupo, ou o nome da outra pessoa (DM). */
  name: string;
  /** Iniciais p/ o avatar (DM usa a outra pessoa; grupo usa o nome do canal). */
  initials: string;
  lastMessage: string | null;
  lastMessageAt: string | null; // ISO
  unread: number;
}

/** Pessoa retornada na busca para iniciar uma conversa. */
export interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

/** Item do sino de notificações in-app. */
export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  createdAt: string; // ISO
  read: boolean;
}

export interface MessageView {
  id: string;
  authorName: string;
  body: string;
  createdAt: string; // ISO
  isOwn: boolean;
}

/** Tudo do detalhe do card, numa chamada só (evita ~6 round trips ao abrir). */
export interface CardDetailData {
  description: string | null;
  checklists: ChecklistView[];
  attachments: AttachmentView[];
  activity: ActivityView[];
  comments: CommentView[];
  responsibleId: string | null; // responsável do card (único, independe de etapa)
  requesterId: string | null; // solicitante (quem abriu o card)
  members: MemberOption[];
}

/** Visão expandida do card (página /card/[id]): tudo + descrição + propriedades. */
export interface CardPageData {
  id: string;
  number: number;
  title: string;
  description: string | null;
  boardId: string;
  boardName: string;
  stageId: string;
  stageName: string;
  fields: FieldDef[];
  values: Record<string, FieldValueRaw>; // por fieldId
  detail: CardDetailData;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  internal: boolean;
  roleId: string | null;
  roleName: string | null;
  cargo: string | null;
  /** Acesso revogado: mantém o histórico, mas não entra mais no sistema. */
  archived: boolean;
}
