"use server";

import { positionAfter, positionBetween } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { loadFieldValuesByBoard, loadFields } from "@/lib/board/actions";
import type { FieldValueRaw } from "@/lib/board/types";
import { computeDemand } from "@/lib/demandas/eval";
import type { QueueData, QueueItem } from "@/lib/demandas/queueTypes";
import { loadBoardThresholds } from "@/lib/demandas/thresholds";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Fila de priorização de um pipeline de demandas: RICE calculado em lote e
 * estado de priorização. Null se o pipeline não for de demandas.
 */
export async function loadPriorityQueue(boardId: string): Promise<QueueData | null> {
  const db = await createClient(); // sessão → RLS escopa

  const { data: board } = await db
    .from("board")
    .select("id, name, creation_form")
    .eq("id", boardId)
    .is("archived_at", null)
    .maybeSingle();
  // A fila de priorização (RICE) é exclusiva do pipeline de demandas — marcado
  // pelo formulário de criação, não por adivinhar nome de campo.
  if (!board || board.creation_form !== "custom:demandas") return null;

  const [fields, allValues, thresholds] = await Promise.all([
    loadFields(boardId),
    loadFieldValuesByBoard(boardId),
    loadBoardThresholds(boardId),
  ]);

  const [cardsRes, stagesRes, rulesRes, priosRes] = await Promise.all([
    db
      .from("card")
      .select("id, number, title, stage_id, created_at")
      .eq("board_id", boardId)
      .is("archived_at", null),
    db.from("stage").select("id, name").eq("board_id", boardId),
    db
      .from("workflow_rule")
      .select("requirement_config")
      .eq("board_id", boardId)
      .eq("requirement", "prioritized")
      .eq("is_active", true),
    db
      .from("prioritization")
      .select("card_id, rank, prioritized_at, prioritized_by")
      .eq("board_id", boardId)
      .is("archived_at", null),
  ]);

  const stageName = new Map((stagesRes.data ?? []).map((s) => [s.id, s.name]));
  // A etapa de checkpoint vem da própria regra — sem string mágica no código.
  const gatedStages = new Set(
    (rulesRes.data ?? [])
      .map((r) => (r.requirement_config as { checkpointStageId?: string } | null)?.checkpointStageId)
      .filter((id): id is string => !!id),
  );

  const prios = priosRes.data ?? [];
  const userIds = [...new Set(prios.map((p) => p.prioritized_by))];
  const userName = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email").in("id", userIds);
    for (const u of users ?? []) userName.set(u.id, u.name || u.email);
  }
  const prioOf = new Map(prios.map((p) => [p.card_id, p]));

  // Responsável do card (assignment sem etapa).
  const cards = cardsRes.data ?? [];
  const respOf = new Map<string, string>();
  if (cards.length > 0) {
    const { data: assigns } = await db
      .from("assignment")
      .select("card_id, user_id")
      .in("card_id", cards.map((c) => c.id))
      .is("stage_id", null);
    const ids = [...new Set((assigns ?? []).map((a) => a.user_id))];
    if (ids.length > 0) {
      const { data: users } = await db.from("app_user").select("id, name, email").in("id", ids);
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.name || u.email]));
      for (const a of assigns ?? []) respOf.set(a.card_id, nameOf.get(a.user_id) ?? "");
    }
  }

  const valuesByCard = new Map<string, FieldValueRaw[]>();
  for (const v of allValues) {
    const arr = valuesByCard.get(v.cardId) ?? [];
    arr.push(v.value);
    valuesByCard.set(v.cardId, arr);
  }

  const items: QueueItem[] = [];
  for (const c of cards) {
    const computed = computeDemand(fields, valuesByCard.get(c.id) ?? [], thresholds);
    if (!computed) continue;
    const p = prioOf.get(c.id);
    items.push({
      cardId: c.id,
      number: Number(c.number),
      title: c.title,
      stageId: c.stage_id,
      stageName: stageName.get(c.stage_id) ?? "—",
      awaitingPrioritization: gatedStages.has(c.stage_id),
      rice: computed.rice,
      riceComplete: computed.riceComplete,
      tipo: computed.fields.tipo,
      area: computed.fields.area,
      orcamento: computed.fields.orcamento,
      urgencia: computed.fields.urgencia,
      risco: computed.fields.risco,
      responsavel: respOf.get(c.id) || null,
      createdAt: c.created_at,
      prioritized: p
        ? {
            by: userName.get(p.prioritized_by) ?? "Alguém",
            at: p.prioritized_at,
            rank: Number(p.rank),
          }
        : null,
    });
  }

  // Priorizadas primeiro (por rank); depois as demais por RICE desc (null no fim).
  items.sort((a, b) => {
    if (a.prioritized && b.prioritized) return a.prioritized.rank - b.prioritized.rank;
    if (a.prioritized) return -1;
    if (b.prioritized) return 1;
    if (a.rice == null && b.rice == null) return a.number - b.number;
    if (a.rice == null) return 1;
    if (b.rice == null) return -1;
    return b.rice - a.rice;
  });

  return { boardId: board.id, boardName: board.name, items };
}

/** Ids dos cards priorizados do pipeline (para marcar/filtrar na lista). */
export async function loadPrioritizedCardIds(boardId: string): Promise<string[]> {
  const db = await createClient();
  const { data } = await db
    .from("prioritization")
    .select("card_id")
    .eq("board_id", boardId)
    .is("archived_at", null);
  return (data ?? []).map((p) => p.card_id);
}

// ── Ações ────────────────────────────────────────────────────────────────────

async function logActivity(
  cardId: string,
  orgId: string,
  actorId: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  await createAdminClient().from("activity").insert({
    organization_id: orgId,
    card_id: cardId,
    actor_id: actorId,
    kind,
    payload,
  });
}

/** Ato explícito de priorizar. Revalida o RICE no servidor. */
export async function prioritizeCard(
  cardId: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("card:update");
  const db = createAdminClient();

  const { data: card } = await db
    .from("card")
    .select("id, board_id, organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "Card não encontrado." };

  const [fields, values, thresholds] = await Promise.all([
    loadFields(card.board_id),
    loadCardValues(cardId),
    loadBoardThresholds(card.board_id),
  ]);
  const computed = computeDemand(fields, values, thresholds);
  if (!computed) return { ok: false, error: "Este card não é uma demanda." };
  if (!computed.riceComplete) {
    return { ok: false, error: "Preencha os 4 campos do RICE antes de priorizar." };
  }

  const { data: existing } = await db
    .from("prioritization")
    .select("id")
    .eq("card_id", cardId)
    .is("archived_at", null)
    .maybeSingle();
  if (existing) return { ok: false, error: "Esta demanda já está priorizada." };

  // Entra no fim da fila.
  const { data: last } = await db
    .from("prioritization")
    .select("rank")
    .eq("board_id", card.board_id)
    .is("archived_at", null)
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rank = last ? positionAfter(Number(last.rank)) : 1000;

  const { error } = await db.from("prioritization").insert({
    organization_id: card.organization_id,
    board_id: card.board_id,
    card_id: cardId,
    prioritized_by: actor.userId as string,
    rank,
    rice_snapshot: computed.rice,
    note: note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  await logActivity(cardId, card.organization_id, actor.userId as string, "demand_prioritized", {
    rice: computed.rice,
    note: note?.trim() || null,
  });
  revalidatePath("/prioridades");
  revalidatePath("/board");
  return { ok: true };
}

/** Remove a priorização (arquiva — preserva o histórico). */
export async function deprioritizeCard(
  cardId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("card:update");
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "Card não encontrado." };

  const { error } = await db
    .from("prioritization")
    .update({ archived_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .is("archived_at", null);
  if (error) return { ok: false, error: error.message };

  await logActivity(cardId, card.organization_id, actor.userId as string, "demand_deprioritized", {});
  revalidatePath("/prioridades");
  revalidatePath("/board");
  return { ok: true };
}

/** Move a demanda uma posição para cima/baixo na fila. */
export async function movePriority(
  cardId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActor("card:update");
  const db = createAdminClient();

  const { data: me } = await db
    .from("prioritization")
    .select("id, board_id, rank")
    .eq("card_id", cardId)
    .is("archived_at", null)
    .maybeSingle();
  if (!me) return { ok: false, error: "Demanda não está priorizada." };

  const base = db
    .from("prioritization")
    .select("id, rank")
    .eq("board_id", me.board_id)
    .is("archived_at", null)
    .limit(2);
  const { data: neighbors } =
    direction === "down"
      ? await base.gt("rank", me.rank).order("rank", { ascending: true })
      : await base.lt("rank", me.rank).order("rank", { ascending: false });

  const list = neighbors ?? [];
  if (list.length === 0) return { ok: true }; // já é a primeira/última
  const first = Number(list[0]!.rank);
  const second = list[1] ? Number(list[1]!.rank) : null;
  const newRank =
    direction === "down"
      ? second != null
        ? positionBetween(first, second)
        : positionAfter(first)
      : second != null
        ? positionBetween(second, first)
        : first / 2;

  const { error } = await db.from("prioritization").update({ rank: newRank }).eq("id", me.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/prioridades");
  return { ok: true };
}

/** Valores de campo de um card (helper local). */
async function loadCardValues(cardId: string): Promise<FieldValueRaw[]> {
  const db = await createClient();
  const { data } = await db
    .from("field_value")
    .select("field_definition_id, value_text, value_number, value_date, value_bool, value_member_id")
    .eq("card_id", cardId);
  return (data ?? []).map((v) => ({
    fieldId: v.field_definition_id,
    text: v.value_text,
    number: v.value_number,
    date: v.value_date,
    bool: v.value_bool,
    memberId: v.value_member_id,
  }));
}
