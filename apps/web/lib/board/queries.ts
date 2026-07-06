import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardData, CardView, StageView, TaxonomyOption } from "./types";

export interface BoardPageData {
  board: BoardData;
  materias: TaxonomyOption[];
  series: TaxonomyOption[];
}

/**
 * Carrega o (único) board com etapas, cards e a taxonomia do formulário.
 * Usa o client admin (dev, sem auth). Quando o login estiver ligado, trocar
 * pelo client de sessão para o RLS escopar por usuário.
 */
export async function loadBoardPage(): Promise<BoardPageData | null> {
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, name, organization_id, segmento_id, ano_letivo_id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!board) return null;

  const [stagesRes, cardsRes, materiasRes, seriesRes] = await Promise.all([
    db.from("stage").select("id, name, category, position").eq("board_id", board.id).order("position"),
    db
      .from("card")
      .select("id, number, code, title, stage_id, bimestre, due_date, materia_id, serie_id")
      .eq("board_id", board.id)
      .order("position"),
    db.from("materia").select("id, name, code").order("position"),
    db.from("serie").select("id, name, code").eq("segmento_id", board.segmento_id).order("position"),
  ]);

  const materias = materiasRes.data ?? [];
  const series = seriesRes.data ?? [];
  const nameOfMateria = new Map(materias.map((m) => [m.id, m.name]));
  const nameOfSerie = new Map(series.map((s) => [s.id, s.name]));

  const stages: StageView[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const cards: CardView[] = (cardsRes.data ?? []).map((c) => ({
    id: c.id,
    number: c.number,
    code: c.code,
    title: c.title,
    stageId: c.stage_id,
    assignee: null,
    labels: [],
    dueDate: c.due_date,
    status: null,
    materia: nameOfMateria.get(c.materia_id) ?? "",
    serie: nameOfSerie.get(c.serie_id) ?? "",
    bimestre: c.bimestre,
  }));

  return {
    board: { name: board.name, stages, cards, members: [] },
    materias: materias.map((m) => ({ id: m.id, name: m.name, code: m.code })),
    series: series.map((s) => ({ id: s.id, name: s.name, code: s.code })),
  };
}
