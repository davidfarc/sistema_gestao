import { memberView } from "@/lib/board/avatar";
import { createClient } from "@/lib/supabase/server";
import type { BoardData, BoardSummary, CardView, FieldChip, FieldType, StageView } from "./types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function resolveChip(f: any, raw: any, nameOf: Map<string, string>): FieldChip | null {
  if (!raw) return null;
  const type = f.type as FieldType;
  const options = (f.config?.options ?? []) as { id: string; label: string; color: string }[];
  const base = { fieldId: f.id as string, name: f.name as string, type };
  switch (type) {
    case "text":
    case "link":
      return raw.value_text ? { ...base, display: raw.value_text, color: null } : null;
    case "number":
      return raw.value_number != null
        ? { ...base, display: String(raw.value_number), color: null }
        : null;
    case "date":
      return raw.value_date ? { ...base, display: formatDate(raw.value_date), color: null } : null;
    case "checkbox":
      return raw.value_bool ? { ...base, display: `✓ ${f.name}`, color: null } : null;
    case "member":
      return raw.value_member_id
        ? { ...base, display: nameOf.get(raw.value_member_id) ?? "?", color: null }
        : null;
    case "select":
    case "status": {
      const opt = options.find((o) => o.id === raw.value_text);
      return opt ? { ...base, display: opt.label, color: opt.color } : null;
    }
    default:
      return null;
  }
}

/**
 * Carrega o board com o CLIENT DE SESSÃO (RLS escopa por usuário). Resolve o
 * responsável da etapa atual e os campos customizados marcados "mostrar no card".
 */
export async function loadBoard(boardId?: string): Promise<BoardData | null> {
  const db = await createClient();

  // Pipeline pedido (se visível) ou o primeiro não-arquivado. RLS escopa.
  let board: { id: string; name: string } | null = null;
  if (boardId) {
    const { data } = await db
      .from("board")
      .select("id, name")
      .eq("id", boardId)
      .is("archived_at", null)
      .maybeSingle();
    board = data;
  }
  if (!board) {
    const { data } = await db
      .from("board")
      .select("id, name")
      .is("archived_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    board = data;
  }
  if (!board) return null;

  const [stagesRes, cardsRes, fieldsRes] = await Promise.all([
    db.from("stage").select("id, name, category, position").eq("board_id", board.id).order("position"),
    db
      .from("card")
      .select("id, number, title, stage_id, due_date")
      .eq("board_id", board.id)
      .order("position"),
    db
      .from("field_definition")
      .select("id, name, type, config, position")
      .or(`board_id.eq.${board.id},board_id.is.null`)
      .eq("show_on_card_face", true)
      .order("position"),
  ]);

  const cardsRaw = cardsRes.data ?? [];
  const cardIds = cardsRaw.map((c) => c.id);
  const showFields = fieldsRes.data ?? [];

  const assigneeOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const memberIds = new Set<string>();

  if (cardIds.length > 0) {
    const { data: assigns } = await db
      .from("assignment")
      .select("card_id, stage_id, user_id")
      .in("card_id", cardIds);
    for (const a of assigns ?? []) {
      if (a.stage_id) assigneeOf.set(`${a.card_id}|${a.stage_id}`, a.user_id);
      memberIds.add(a.user_id);
    }
  }

  const valueOf = new Map<string, unknown>();
  if (cardIds.length > 0 && showFields.length > 0) {
    const { data: vals } = await db
      .from("field_value")
      .select("card_id, field_definition_id, value_text, value_number, value_date, value_bool, value_member_id")
      .in("card_id", cardIds)
      .in(
        "field_definition_id",
        showFields.map((f) => f.id),
      );
    for (const v of vals ?? []) {
      valueOf.set(`${v.card_id}|${v.field_definition_id}`, v);
      if (v.value_member_id) memberIds.add(v.value_member_id);
    }
  }

  if (memberIds.size > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email").in("id", [...memberIds]);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  const stages: StageView[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const cards: CardView[] = cardsRaw.map((c) => {
    const uid = assigneeOf.get(`${c.id}|${c.stage_id}`);
    const fields: FieldChip[] = [];
    for (const f of showFields) {
      const chip = resolveChip(f, valueOf.get(`${c.id}|${f.id}`), nameOf);
      if (chip) fields.push(chip);
    }
    return {
      id: c.id,
      number: Number(c.number),
      title: c.title,
      stageId: c.stage_id,
      assignee: uid ? memberView(uid, nameOf.get(uid) ?? "?") : null,
      labels: [],
      status: null,
      dueDate: c.due_date,
      fields,
    };
  });

  return { id: board.id, name: board.name, stages, cards, members: [] };
}

/** Lista os pipelines visíveis (RLS: interno vê todos; externo os atribuídos). */
export async function loadBoards(): Promise<BoardSummary[]> {
  const db = await createClient();
  const { data } = await db
    .from("board")
    .select("id, name, archived_at")
    .order("created_at");
  return (data ?? []).map((b) => ({ id: b.id, name: b.name, archived: b.archived_at != null }));
}
