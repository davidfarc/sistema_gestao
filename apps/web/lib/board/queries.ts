import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardData, CardView, StageView } from "./types";

/**
 * Carrega o (único) board com etapas e cards. Usa o client admin (dev, sem auth).
 * Quando o login estiver ligado, trocar pelo client de sessão para o RLS escopar
 * por usuário. Matéria/série são resolvidas por nome para exibição (cards podem
 * ainda não ter taxonomia — nascem só com nome).
 */
export async function loadBoard(): Promise<BoardData | null> {
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, name")
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
    db.from("materia").select("id, name"),
    db.from("serie").select("id, name"),
  ]);

  const nameOfMateria = new Map((materiasRes.data ?? []).map((m) => [m.id, m.name]));
  const nameOfSerie = new Map((seriesRes.data ?? []).map((s) => [s.id, s.name]));

  const stages: StageView[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const cards: CardView[] = (cardsRes.data ?? []).map((c) => ({
    id: c.id,
    number: Number(c.number),
    code: c.code ?? "",
    title: c.title,
    stageId: c.stage_id,
    assignee: null,
    labels: [],
    dueDate: c.due_date,
    status: null,
    materia: c.materia_id ? (nameOfMateria.get(c.materia_id) ?? "") : "",
    serie: c.serie_id ? (nameOfSerie.get(c.serie_id) ?? "") : "",
    bimestre: c.bimestre == null ? 0 : Number(c.bimestre),
    materiaId: c.materia_id ?? null,
    serieId: c.serie_id ?? null,
  }));

  return { name: board.name, stages, cards, members: [] };
}
