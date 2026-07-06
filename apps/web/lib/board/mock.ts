import { buildCardCode } from "@ecco/core";

import type { BoardData, CardView, Member, StageCategory, StageView } from "./types";

// ── Etapas (as 19 do BPMN, mesma ordem do seed) ──────────────────────────────
const STAGE_NAMES: string[] = [
  "Comunicação da demanda",
  "Elaboração do documento da demanda",
  "Produção do sumário",
  "Validação do sumário",
  "Escrita do livro",
  "Revisão de área",
  "Reescrita",
  "Diagramação 1",
  "Revisão 1",
  "Avaliação do manuscrito",
  "Supervisão da produção da 1ª emenda",
  "Diagramação 2",
  "Revisão 2",
  "Revisão editorial",
  "Diagramação 3",
  "Revisão Coordenação",
  "Revisão final",
  "Ajuste da versão final",
  "Catálogo",
];

function categoryFor(name: string, index: number): StageCategory {
  if (index === 0) return "backlog";
  if (name === "Catálogo") return "done";
  if (/^Revis|^Valida|^Avalia/.test(name)) return "review";
  return "in_progress";
}

export const STAGES: StageView[] = STAGE_NAMES.map((name, i) => ({
  id: `s${i + 1}`,
  name,
  category: categoryFor(name, i),
}));

// ── Pessoas (para o campo "pessoa" ligado ao usuário) ────────────────────────
const MEMBERS: Member[] = [
  { id: "u1", name: "Ana Souza", initials: "AS", colorClass: "bg-rose-500" },
  { id: "u2", name: "Bruno Lima", initials: "BL", colorClass: "bg-sky-500" },
  { id: "u3", name: "Carla Dias", initials: "CD", colorClass: "bg-emerald-500" },
  { id: "u4", name: "Diego Alves", initials: "DA", colorClass: "bg-violet-500" },
  { id: "u5", name: "Elena Rocha", initials: "ER", colorClass: "bg-amber-500" },
];

const STATUS = {
  ok: { label: "No prazo", colorClass: "bg-emerald-100 text-emerald-700" },
  warn: { label: "Atenção", colorClass: "bg-amber-100 text-amber-700" },
  late: { label: "Atrasado", colorClass: "bg-rose-100 text-rose-700" },
};

const LABELS = {
  aluno: { text: "Livro do aluno", colorClass: "bg-indigo-100 text-indigo-700" },
  professor: { text: "Manual do professor", colorClass: "bg-teal-100 text-teal-700" },
  urgente: { text: "Urgente", colorClass: "bg-rose-100 text-rose-700" },
};

// ── Cards (matéria × série × bimestre), código gerado pelo @ecco/core ────────
interface Seed {
  materia: { code: string; name: string };
  serie: { code: string; name: string };
  bimestre: 0 | 1 | 2 | 3 | 4;
  title: string;
  stageId: string;
  assignee: Member | null;
  labels: CardView["labels"];
  status: CardView["status"];
  dueDate: string | null;
}

const SEG = { code: "FUND2", name: "Fundamental 2" };
const YEAR = 2027;

const SEEDS: Seed[] = [
  { materia: { code: "TEX", name: "Produção de Texto" }, serie: { code: "7A", name: "7º ano" }, bimestre: 1, title: "Produção de Texto — 7º ano — 1º bim", stageId: "s5", assignee: MEMBERS[0]!, labels: [LABELS.aluno], status: STATUS.ok, dueDate: "2027-03-15" },
  { materia: { code: "MAT", name: "Matemática" }, serie: { code: "6A", name: "6º ano" }, bimestre: 1, title: "Matemática — 6º ano — 1º bim", stageId: "s6", assignee: MEMBERS[1]!, labels: [LABELS.aluno], status: STATUS.warn, dueDate: "2027-03-10" },
  { materia: { code: "POR", name: "Português" }, serie: { code: "8A", name: "8º ano" }, bimestre: 2, title: "Português — 8º ano — 2º bim", stageId: "s3", assignee: MEMBERS[2]!, labels: [LABELS.aluno, LABELS.professor], status: STATUS.ok, dueDate: null },
  { materia: { code: "CIE", name: "Ciências" }, serie: { code: "9A", name: "9º ano" }, bimestre: 1, title: "Ciências — 9º ano — 1º bim", stageId: "s8", assignee: MEMBERS[3]!, labels: [LABELS.aluno], status: STATUS.late, dueDate: "2027-02-28" },
  { materia: { code: "HIS", name: "História" }, serie: { code: "7A", name: "7º ano" }, bimestre: 2, title: "História — 7º ano — 2º bim", stageId: "s1", assignee: null, labels: [], status: null, dueDate: null },
  { materia: { code: "GEO", name: "Geografia" }, serie: { code: "8A", name: "8º ano" }, bimestre: 1, title: "Geografia — 8º ano — 1º bim", stageId: "s9", assignee: MEMBERS[4]!, labels: [LABELS.professor], status: STATUS.ok, dueDate: "2027-04-01" },
  { materia: { code: "ART", name: "Artes" }, serie: { code: "6A", name: "6º ano" }, bimestre: 0, title: "Artes — 6º ano — anual", stageId: "s2", assignee: MEMBERS[0]!, labels: [LABELS.aluno], status: STATUS.warn, dueDate: null },
  { materia: { code: "MAT", name: "Matemática" }, serie: { code: "9A", name: "9º ano" }, bimestre: 3, title: "Matemática — 9º ano — 3º bim", stageId: "s12", assignee: MEMBERS[1]!, labels: [LABELS.aluno, LABELS.urgente], status: STATUS.late, dueDate: "2027-02-20" },
  { materia: { code: "TEX", name: "Produção de Texto" }, serie: { code: "8A", name: "8º ano" }, bimestre: 1, title: "Produção de Texto — 8º ano — 1º bim", stageId: "s6", assignee: MEMBERS[2]!, labels: [LABELS.aluno], status: STATUS.ok, dueDate: "2027-03-22" },
  { materia: { code: "POR", name: "Português" }, serie: { code: "6A", name: "6º ano" }, bimestre: 1, title: "Português — 6º ano — 1º bim", stageId: "s14", assignee: MEMBERS[3]!, labels: [LABELS.professor], status: STATUS.ok, dueDate: "2027-04-10" },
  { materia: { code: "CIE", name: "Ciências" }, serie: { code: "7A", name: "7º ano" }, bimestre: 2, title: "Ciências — 7º ano — 2º bim", stageId: "s5", assignee: MEMBERS[4]!, labels: [LABELS.aluno], status: STATUS.warn, dueDate: null },
  { materia: { code: "HIS", name: "História" }, serie: { code: "9A", name: "9º ano" }, bimestre: 4, title: "História — 9º ano — 4º bim", stageId: "s19", assignee: MEMBERS[0]!, labels: [LABELS.aluno], status: STATUS.ok, dueDate: "2027-01-30" },
];

export const MOCK_BOARD: BoardData = {
  name: "Produção 2027 — Fundamental 2",
  stages: STAGES,
  members: MEMBERS,
  cards: SEEDS.map((s, i): CardView => ({
    id: `c${i + 1}`,
    number: i + 1,
    code: buildCardCode({
      materiaCode: s.materia.code,
      serieCode: s.serie.code,
      segmentoCode: SEG.code,
      bimestre: s.bimestre,
      year: YEAR,
    }),
    title: s.title,
    stageId: s.stageId,
    assignee: s.assignee,
    labels: s.labels,
    dueDate: s.dueDate,
    status: s.status,
    materia: s.materia.name,
    serie: s.serie.name,
    bimestre: s.bimestre,
  })),
};
