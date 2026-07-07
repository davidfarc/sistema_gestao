/**
 * View-models da UI do quadro. Leves e desacoplados da persistência.
 * O card é identificado pela numeração (#number) + título — sem taxonomia.
 */

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
  labels: Label[];
  dueDate: string | null; // ISO
  status: StatusValue | null;
  fields: FieldChip[]; // campos customizados marcados "mostrar no card"
}

// ── Propriedades customizadas (campos) ──────────────────────────────────────

export type FieldType =
  | "text"
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
  position: number;
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
  checklists: ChecklistView[];
  attachments: AttachmentView[];
  activity: ActivityView[];
  comments: CommentView[];
  assignments: { stageId: string; userId: string }[];
  members: MemberOption[];
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
}
