import { parseThresholds } from "@ecco/core";
import { cookies } from "next/headers";

import { memberView } from "@/lib/board/avatar";
import { createClient } from "@/lib/supabase/server";
import { LAST_BOARD_COOKIE, parseIntake } from "./types";
import { resolveChip, type ChipField } from "./chips";
import type {
  BoardData,
  BoardSummary,
  CardView,
  FieldChip,
  FieldValueRaw,
  StageView,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Linha de `field_value` → forma usada pela tela. */
function rawValue(v: any): FieldValueRaw {
  return {
    fieldId: v.field_definition_id,
    text: v.value_text ?? null,
    number: v.value_number != null ? Number(v.value_number) : null,
    date: v.value_date ?? null,
    bool: v.value_bool ?? null,
    memberId: v.value_member_id ?? null,
  };
}

/**
 * Carrega o board com o CLIENT DE SESSÃO (RLS escopa por usuário). Resolve o
 * responsável da etapa atual e os campos customizados marcados "mostrar no card".
 */
export async function loadBoard(boardId?: string): Promise<BoardData | null> {
  const db = await createClient();

  // Pipeline pedido (se visível) ou o primeiro não-arquivado. RLS escopa.
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
  // Sem pipeline na URL: o último que a pessoa deixou aberto (cookie gravado
  // pela BoardView). RLS escopa, então um cookie velho de um pipeline que ela
  // perdeu acesso simplesmente não resolve e cai no fallback.
  if (!board) {
    const last = (await cookies()).get(LAST_BOARD_COOKIE)?.value;
    if (last) {
      const { data } = await db
        .from("board")
        .select("id, name, creation_form, alcada_thresholds, intake")
        .eq("id", last)
        .is("archived_at", null)
        .maybeSingle();
      board = data;
    }
  }
  // Primeira visita: o primeiro em ordem alfabética — a mesma ordem do seletor,
  // por isso ordenado aqui com byName (e não no Postgres, cuja collation
  // divergiria da do navegador).
  if (!board) {
    const { data } = await db
      .from("board")
      .select("id, name, creation_form, alcada_thresholds, intake")
      .is("archived_at", null);
    board = (data ?? []).sort(byName)[0] ?? null;
  }
  if (!board) return null;

  const [stagesRes, cardsRes, fieldsRes, gateRes, prioRes] = await Promise.all([
    db.from("stage").select("id, name, category, position, wip_limit").eq("board_id", board.id).order("position"),
    db
      .from("card")
      .select("id, number, title, stage_id, due_date, requester_id, position")
      .eq("board_id", board.id)
      .order("position")
      .order("number"), // desempate estável: cards antigos têm todos position 1000
    db
      .from("field_definition")
      .select("id, name, type, config, position")
      .or(`board_id.eq.${board.id},board_id.is.null`)
      .eq("show_on_card_face", true)
      .order("position"),
    // Etapa de checkpoint da priorização — vem da regra, sem nome fixo no código.
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
  const showFields: ChipField[] = (fieldsRes.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    options: (f.config?.options ?? []) as ChipField["options"],
  }));

  const assigneeOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const memberIds = new Set<string>();

  if (cardIds.length > 0) {
    // Responsável por card = assignment com stage_id nulo (independe da etapa).
    const { data: assigns } = await db
      .from("assignment")
      .select("card_id, user_id")
      .is("stage_id", null)
      .in("card_id", cardIds);
    for (const a of assigns ?? []) {
      assigneeOf.set(a.card_id, a.user_id);
      memberIds.add(a.user_id);
    }
    // Solicitante é coluna do próprio card.
    for (const c of cardsRaw) {
      if (c.requester_id) memberIds.add(c.requester_id);
    }
  }

  // Progresso de checklist e nº de comentários, para a face do card.
  const checklistOf = new Map<string, { done: number; total: number }>();
  const commentsOf = new Map<string, number>();
  if (cardIds.length > 0) {
    const [{ data: lists }, { data: comments }] = await Promise.all([
      db
        .from("checklist")
        .select("card_id, checklist_item(done)")
        .in("card_id", cardIds)
        .is("archived_at", null),
      db.from("comment").select("card_id").in("card_id", cardIds).is("archived_at", null),
    ]);
    for (const l of lists ?? []) {
      const items = (l.checklist_item ?? []) as { done: boolean }[];
      const cur = checklistOf.get(l.card_id) ?? { done: 0, total: 0 };
      cur.total += items.length;
      cur.done += items.filter((i) => i.done).length;
      checklistOf.set(l.card_id, cur);
    }
    for (const c of comments ?? []) {
      commentsOf.set(c.card_id, (commentsOf.get(c.card_id) ?? 0) + 1);
    }
  }

  const valueOf = new Map<string, FieldValueRaw>();
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
      valueOf.set(`${v.card_id}|${v.field_definition_id}`, rawValue(v));
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
    wipLimit: s.wip_limit ?? null,
  }));

  const cards: CardView[] = cardsRaw.map((c) => {
    const uid = assigneeOf.get(c.id);
    const fields: FieldChip[] = [];
    for (const f of showFields) {
      const chip = resolveChip(f, valueOf.get(`${c.id}|${f.id}`), (id) => nameOf.get(id));
      if (chip) fields.push(chip);
    }
    return {
      id: c.id,
      number: Number(c.number),
      title: c.title,
      stageId: c.stage_id,
      position: Number(c.position),
      assignee: uid ? memberView(uid, nameOf.get(uid) ?? "?") : null,
      requester: c.requester_id
        ? memberView(c.requester_id, nameOf.get(c.requester_id) ?? "?")
        : null,
      labels: [],
      status: null,
      dueDate: c.due_date,
      fields,
      checklist: checklistOf.get(c.id) ?? null,
      commentCount: commentsOf.get(c.id) ?? 0,
      awaitingPrioritization: gatedStages.has(c.stage_id) && !prioritizedCards.has(c.id),
      prioritized: prioritizedCards.has(c.id),
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
    gatedStageIds: [...gatedStages],
    loadedAt: Date.now(),
  };
}

/**
 * Lista os pipelines visíveis (RLS: interno vê todos; externo os atribuídos),
 * em ordem alfabética. A ordenação é feita aqui, e não no `order()` do Postgres,
 * porque o collation do banco não conhece as regras do português — "Ávila"
 * viria depois de "Bahia". A lista é curta, então o custo é irrelevante.
 */
export async function loadBoards(): Promise<BoardSummary[]> {
  const db = await createClient();
  const { data } = await db.from("board").select("id, name, archived_at");
  return (data ?? [])
    .map((b) => ({ id: b.id, name: b.name, archived: b.archived_at != null }))
    .sort(byName);
}

/** Comparador alfabético pt-BR: ignora caixa e trata acento como a letra base. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true });
}

