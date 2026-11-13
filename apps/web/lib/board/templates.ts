import type { FieldType, StageCategory } from "./types";

/**
 * Modelos de pipeline: etapas, propriedades e opções já prontas ao criar.
 * O pipeline criado é um pipeline comum; tudo pode ser mudado depois.
 */
export interface BoardTemplate {
  id: string;
  label: string;
  description: string;
  stages: { name: string; category: StageCategory; countsRework?: boolean }[];
  fields: {
    name: string;
    type: FieldType;
    options?: string[];
    showOnCard?: boolean;
    showOnCreate?: boolean;
  }[];
  options: { myTasks?: boolean; timeTracking?: boolean; ownPanel?: boolean };
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "producao_pedagogica",
    label: "Produção Pedagógica",
    description:
      "Materiais da editora: Em produção → Aguardando análise → Em emenda → Aprovado, com segmento, tipo, emendas, cronômetro e painel próprio.",
    stages: [
      { name: "Em produção", category: "in_progress" },
      { name: "Aguardando análise", category: "review" },
      { name: "Em emenda", category: "in_progress", countsRework: true },
      { name: "Aprovado", category: "done" },
    ],
    fields: [
      {
        name: "Segmento",
        type: "select",
        options: ["Infantil", "Fundamental 1", "Fundamental 2"],
        showOnCard: true,
        showOnCreate: true,
      },
      {
        name: "Tipo de material",
        type: "select",
        options: ["Básico", "Up Grades", "Escrita do Zero", "Revisão Diagramado"],
        showOnCard: true,
        showOnCreate: true,
      },
      { name: "Início", type: "date", showOnCreate: true },
      { name: "Finalização", type: "date" },
      { name: "Link do autor", type: "link", showOnCreate: true },
    ],
    options: { myTasks: true, timeTracking: true, ownPanel: true },
  },
];

const OPTION_COLORS = ["#1d4ed8", "#047857", "#b45309", "#ba1a1a", "#7c3aed", "#0891b2"];
export function templateOptions(labels: string[]) {
  return labels.map((label, i) => ({ id: `opt${i}`, label, color: OPTION_COLORS[i % OPTION_COLORS.length]! }));
}
