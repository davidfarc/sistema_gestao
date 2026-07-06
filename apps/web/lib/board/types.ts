/**
 * View-models da UI do quadro. Propositalmente leves e desacoplados da forma de
 * persistência (@ecco/core / banco). Quando plugarmos dados reais, mapeamos as
 * entidades do core para estes tipos numa camada fina.
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

/** Valor de um "Status" (campo customizado tipo select) para demonstração. */
export interface StatusValue {
  label: string;
  colorClass: string;
}

export interface CardView {
  id: string;
  number: number; // ID sequencial por quadro (#1, #2…), estilo Notion
  code: string; // TEX-7A-FUND2-1B-2027
  title: string;
  stageId: string;
  assignee: Member | null;
  labels: Label[];
  dueDate: string | null; // ISO
  status: StatusValue | null; // campo customizado
  materia: string;
  serie: string;
  bimestre: number;
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

/** Opção de taxonomia para o formulário de novo card. */
export interface TaxonomyOption {
  id: string;
  name: string;
  code: string;
}

