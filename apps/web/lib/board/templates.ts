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
    required?: boolean;
  }[];
  options: { myTasks?: boolean; timeTracking?: boolean; ownPanel?: boolean };
  /** Liga o atendimento pelo WhatsApp já com estas instruções (migration 0050). */
  whatsapp?: { instructions: string };
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
  {
    id: "editora_revisao",
    label: "Editora Revisão",
    description:
      "Erros apontados nos livros por escolas e leitores: Backlog → Em produção → Feito, com série, disciplina, período e página, e atendimento pelo WhatsApp já ligado (foto do erro vai para o card).",
    stages: [
      { name: "Backlog", category: "backlog" },
      { name: "Em produção", category: "in_progress" },
      { name: "Feito", category: "done" },
    ],
    fields: [
      {
        name: "Série",
        type: "select",
        options: [
          "Infantil 2 anos",
          "Infantil 3 anos",
          "Infantil 4 anos",
          "Infantil 5 anos",
          "1º ano",
          "2º ano",
          "3º ano",
          "4º ano",
          "5º ano",
          "6º ano",
          "7º ano",
          "8º ano",
          "9º ano",
        ],
        showOnCard: true,
        showOnCreate: true,
        required: true,
      },
      {
        name: "Disciplina",
        type: "select",
        options: ["Português", "Matemática", "Ciências", "História", "Geografia", "Inglês", "Arte", "Ensino Religioso"],
        showOnCard: true,
        showOnCreate: true,
        required: true,
      },
      {
        name: "Período",
        type: "select",
        options: ["1ª unidade", "2ª unidade", "3ª unidade", "4ª unidade", "1º semestre", "2º semestre", "Anual"],
        showOnCard: true,
        showOnCreate: true,
        required: true,
      },
      { name: "Página", type: "text", showOnCard: true, showOnCreate: true, required: true },
    ],
    options: {},
    whatsapp: {
      instructions:
        "Registro de erros encontrados nos livros da editora (ortografia, conteúdo, imagem, diagramação), normalmente apontados por escolas. No menu, chame de \"Erro em livro\". " +
        "Cada pedido é UM erro. Peça a série, a disciplina, o período do livro (unidade, semestre ou anual), a página e a descrição do erro (qual palavra ou trecho está errado e como deveria ser). " +
        "Peça também a foto da página, se a pessoa ainda não enviou. " +
        "Antes de abrir, repita todos os dados e peça confirmação, por exemplo: \"Confirmando: Ciências, 3º ano, 1ª unidade, página 134, erro na palavra 'porta'. Posso registrar?\". Só abra depois do sim. " +
        "No título, use o formato \"Disciplina Série - Período - p. Página - resumo do erro\". " +
        "É o mesmo pedido apenas se for o mesmo erro na mesma página do mesmo livro.",
    },
  },
];

const OPTION_COLORS = ["#1d4ed8", "#047857", "#b45309", "#ba1a1a", "#7c3aed", "#0891b2"];
export function templateOptions(labels: string[]) {
  return labels.map((label, i) => ({ id: `opt${i}`, label, color: OPTION_COLORS[i % OPTION_COLORS.length]! }));
}
