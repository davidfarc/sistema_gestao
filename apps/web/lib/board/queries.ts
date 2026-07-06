import { memberView } from "@/lib/board/avatar";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardData, CardView, StageView } from "./types";

/**
 * Carrega o (único) board com etapas e cards. Usa o client admin (dev, sem auth).
 * O `assignee` de cada card = responsável atribuído à ETAPA ATUAL do card.
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

  const cardsRaw = cardsRes.data ?? [];
  const cardIds = cardsRaw.map((c) => c.id);

  // Responsáveis (assignment card↔user↔etapa) + nomes.
  const assigneeOf = new Map<string, string>(); // "cardId|stageId" -> userId
  const nameOf = new Map<string, string>();
  if (cardIds.length > 0) {
    const { data: assigns } = await db
      .from("assignment")
      .select("card_id, stage_id, user_id")
      .in("card_id", cardIds);
    for (const a of assigns ?? []) {
      if (a.stage_id) assigneeOf.set(`${a.card_id}|${a.stage_id}`, a.user_id);
    }
    const userIds = [...new Set((assigns ?? []).map((a) => a.user_id))];
    if (userIds.length > 0) {
      const { data: users } = await db.from("app_user").select("id, name, email").in("id", userIds);
      for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
    }
  }

  const stages: StageView[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const cards: CardView[] = cardsRaw.map((c) => {
    const uid = assigneeOf.get(`${c.id}|${c.stage_id}`);
    return {
      id: c.id,
      number: Number(c.number),
      title: c.title,
      stageId: c.stage_id,
      assignee: uid ? memberView(uid, nameOf.get(uid) ?? "?") : null,
      labels: [],
      status: null,
      dueDate: c.due_date,
    };
  });

  return { name: board.name, stages, cards, members: [] };
}
