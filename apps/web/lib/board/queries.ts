import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardData, CardView, StageView } from "./types";

/**
 * Carrega o (único) board com etapas e cards. Usa o client admin (dev, sem auth).
 * Quando o login estiver ligado, trocar pelo client de sessão para o RLS escopar
 * por usuário.
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

  const [stagesRes, cardsRes] = await Promise.all([
    db.from("stage").select("id, name, category, position").eq("board_id", board.id).order("position"),
    db
      .from("card")
      .select("id, number, title, stage_id, due_date")
      .eq("board_id", board.id)
      .order("position"),
  ]);

  const stages: StageView[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const cards: CardView[] = (cardsRes.data ?? []).map((c) => ({
    id: c.id,
    number: Number(c.number),
    title: c.title,
    stageId: c.stage_id,
    assignee: null,
    labels: [],
    status: null,
    dueDate: c.due_date,
  }));

  return { name: board.name, stages, cards, members: [] };
}
