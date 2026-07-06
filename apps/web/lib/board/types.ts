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
}

export type StageCategory = "backlog" | "in_progress" | "review" | "done";

export interface StageView {
  id: string;
  name: string;
  category: StageCategory;
}

export interface BoardData {
  name: string;
  stages: StageView[];
  cards: CardView[];
  members: Member[];
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

export interface MemberOption {
  id: string;
  name: string;
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
