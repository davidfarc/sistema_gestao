import { parseThresholds } from "@ecco/core";

import { memberView } from "@/lib/board/avatar";
import { createClient } from "@/lib/supabase/server";
import { parseIntake } from "./types";
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
    case "long_text":
    case "link":
      return raw.value_text
        ? { ...base, display: String(raw.value_text).slice(0, 60), color: null }
        : null;
    case "number":
      return raw.value_number != null
        ? { ...base, display: String(raw.value_number), color: null }
        : null;
    case "date":
      return raw.value_date ? { ...base, display: formatDate(raw.value_date), color: null } : null;
    case "checkbox":
      return raw.value_bool ? { ...base, display: `âœ“ ${f.name}`, color: null } : null;
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
 * Carrega o board com o CLIENT DE SESSÃƒO (RLS escopa por usuÃ¡rio). Resolve o
 * responsÃ¡vel da etapa atual e os campos customizados marcados "mostrar no card".
 */
export async function loadBoard(boardId?: string): Promise<BoardData | null> {
  const db = await createClient();

  // Pipeline pedido (se visÃ­vel) ou o primeiro nÃ£o-arquivado. RLS escopa.
  let board: {
    id: string;
    name: string;
    creation_form: string;
    alcada_thresholds: unknown;
    intake: string;
  } | null = null;
  if (boardId) {
    const { data } = await db
      .from("board")
      .select("id, name, creation_form, alcada_thresholds, intake")
      .eq("id", boardId)
      .is("archived_at", null)
      .maybeSingle();
    board = data;
  }
  if (!board) {
    const { data } = await db
      .from("board")
      .select("id, name, creation_form, alcada_thresholds, intake")
      .is("archived_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    board = data;
  }
  if (!board) return null;

  const [stagesRes, cardsRes, fieldsRes, gateRes, prioRes] = await Promise.all([
    db.from("stage").select("id, name, category, position").eq("board_id", board.id).order("position"),
    db
      .from("card")
      .select("id, number, title, stage_id, due_date, requester_id")
      .eq("board_id", board.id)
      .order("position"),
    db
      .from("field_definition")
      .select("id, name, type, config, position")
      .or(`board_id.eq.${board.id},board_id.is.null`)
      .eq("show_on_card_face", true)
      .order("position"),
    // Etapa de checkpoint da priorizaÃ§Ã£o â€” vem da regra, sem nome fixo no cÃ³digo.
    db
      .from("workflow_rule")
      .select("requirement_config")
      .eq("board_id", board.id)
      .eq("requirement", "prioritized")
      .eq("is_active", true),
    db
      .from("prioritization")
      .select("card_id")
      .eq("board_id", board.id)
      .is("archived_at", null),
  ]);

  const gatedStages = new Set(
    (gateRes.data ?? [])
      .map((r) => (r.requirement_config as { checkpointStageId?: string } | null)?.checkpointStageId)
      .filter((id): id is string => !!id),
  );
  const prioritizedCards = new Set((prioRes.data ?? []).map((p) => p.card_id));

  const cardsRaw = cardsRes.data ?? [];
  const cardIds = cardsRaw.map((c) => c.id);
  const showFields = fieldsRes.data ?? [];

  const assigneeOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const memberIds = new Set<string>();

  if (cardIds.length > 0) {
    // ResponsÃ¡vel por card = assignment com stage_id nulo (independe da etapa).
    const { data: assigns } = await db
      .from("assignment")
      .select("card_id, user_id")
      .is("stage_id", null)
      .in("card_id", cardIds);
    for (const a of assigns ?? []) {
      assigneeOf.set(a.card_id, a.user_id);
      memberIds.add(a.user_id);
    }
    // Solicitante Ã© coluna do prÃ³prio card.
    for (const c of cardsRaw) {
      if (c.requester_id) memberIds.add(c.requester_id);
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
    const uid = assigneeOf.get(c.id);
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
      requester: c.requester_id
        ? memberView(c.requester_id, nameOf.get(c.requester_id) ?? "?")
        : null,
      labels: [],
      status: null,
      dueDate: c.due_date,
      fields,
      awaitingPrioritization: gatedStages.has(c.stage_id) && !prioritizedCards.has(c.id),
    };
  });

  return {
    id: board.id,
    name: board.name,
    creationForm: (board.creation_form ?? "simple") as BoardData["creationForm"],
    alcadaThresholds: parseThresholds(board.alcada_thresholds),
    intake: parseIntake(board.intake),
    stages,
    cards,
    members: [],
  };
}

/**
 * Lista os pipelines visÃ­veis (RLS: interno vÃª todos; externo os atribuÃ­dos),
 * em ordem alfabÃ©tica. A ordenaÃ§Ã£o Ã© feita aqui, e nÃ£o no `order()` do Postgres,
 * porque o collation do banco nÃ£o conhece as regras do portuguÃªs â€” "Ãvila"
 * viria depois de "Bahia". A lista Ã© curta, entÃ£o o custo Ã© irrelevante.
 */
export async function loadBoards(): Promise<BoardSummary[]> {
  const db = await createClient();
  const { data } = await db.from("board").select("id, name, archived_at");
  return (data ?? [])
    .map((b) => ({ id: b.id, name: b.name, archived: b.archived_at != null }))
    .sort(byName);
}

/** Comparador alfabÃ©tico pt-BR: ignora caixa e trata acento como a letra base. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true });
}

