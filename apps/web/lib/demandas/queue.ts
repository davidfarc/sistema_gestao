"use server";

import { CardService, positionAfter, positionBetween, type Actor } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { loadFieldValuesByBoard, loadFields } from "@/lib/board/actions";
import { createSupabaseMovePort } from "@/lib/board/cardMoveAdapter";
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
    const awaiting = gatedStages.has(c.stage_id);
    // O painel é a mesa de priorização, não um inventário do pipeline: entra
    // quem está no checkpoint e quem já foi priorizado (estes precisam seguir
    // visíveis na fila mesmo depois de avançarem de etapa). Sem checkpoint
    // configurado não há o que filtrar — mostra tudo, como antes.
    if (gatedStages.size > 0 && !awaiting && !p) continue;
    items.push({
      cardId: c.id,
      number: Number(c.number),
      title: c.title,
      stageId: c.stage_id,
      stageName: stageName.get(c.stage_id) ?? "—",
      awaitingPrioritization: awaiting,
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

/**
 * As duas etapas que a regra de priorização define: o CHECKPOINT (onde se
 * prioriza) e a etapa SEGUINTE (destino de quem foi priorizado). Sai da própria
 * regra — sem nome de etapa chumbado, então renomear ou reordenar colunas não
 * quebra nada. Null quando o pipeline não tem trava de priorização.
 */
async function prioritizationStages(
  db: ReturnType<typeof createAdminClient>,
  boardId: string,
): Promise<{ checkpointId: string; posOf: Map<string, number>; nextId: string | null } | null> {
  const { data: rules } = await db
    .from("workflow_rule")
    .select("requirement_config")
    .eq("board_id", boardId)
    .eq("requirement", "prioritized")
    .eq("is_active", true);
  const checkpointId = (rules ?? [])
    .map((r) => (r.requirement_config as { checkpointStageId?: string } | null)?.checkpointStageId)
    .find((id): id is string => !!id);
  if (!checkpointId) return null;

  const { data: stages } = await db.from("stage").select("id, position").eq("board_id", boardId);
  const posOf = new Map((stages ?? []).map((s) => [s.id as string, Number(s.position)]));
  const cp = posOf.get(checkpointId);
  if (cp == null) return null;

  const next = [...posOf.entries()]
    .filter(([, pos]) => pos > cp)
    .sort((a, b) => a[1] - b[1])[0];
  return { checkpointId, posOf, nextId: next?.[0] ?? null };
}

/**
 * Move o card como CONSEQUÊNCIA de priorizar/despriorizar — é o sistema
 * seguindo o fluxo, não a pessoa arrastando. Por isso concede `card:move` ao
 * ator: quem tem autoridade para priorizar autoriza o avanço que decorre disso
 * (o papel "Externo", por exemplo, tem `card:update` mas não `card:move`).
 * Os gates do quadro continuam sendo avaliados normalmente.
 */
async function moveAsConsequence(
  actor: Actor,
  cardId: string,
  toStageId: string,
  orgId: string,
  reason: string,
): Promise<string | null> {
  const elevated: Actor = {
    ...actor,
    permissions: new Set([...actor.permissions, "card:move"]),
  };
  const service = new CardService(createSupabaseMovePort(), () => new Date().toISOString());
  try {
    const res = await service.move(elevated, cardId, toStageId);
    if (res.moved) {
      await logActivity(cardId, orgId, actor.userId as string, "card_moved", { toStageId, reason });
    }
    return null;
  } catch (e) {
    // A priorização em si já valeu; só o passeio do card falhou. Devolver o
    // motivo em vez de engolir — senão a pessoa fica sem entender por que o
    // card não saiu do lugar.
    return e instanceof Error ? e.message : "não foi possível mover o card";
  }
}

/** Ato explícito de priorizar. Revalida o RICE no servidor. */
export async function prioritizeCard(
  cardId: string,
  note?: string,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const actor = await requireActor("card:update");
  const db = createAdminClient();

  const { data: card } = await db
    .from("card")
    .select("id, board_id, organization_id, stage_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "Card não encontrado." };

  // Só se prioriza no checkpoint. Priorizar uma demanda que ainda está atrás
  // dele criaria uma fila com demanda que nem passou por cotação/confirmação —
  // e o card não teria para onde avançar sem pular etapas.
  const stages = await prioritizationStages(db, card.board_id);
  if (stages && card.stage_id !== stages.checkpointId) {
    return {
      ok: false,
      error: "Só é possível priorizar demandas que já estão em “Aguardando priorização”.",
    };
  }

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

  // Priorizar É o ato que libera a demanda: ela segue para a etapa seguinte ao
  // checkpoint em vez de ficar parada esperando alguém arrastar.
  let warning: string | null = null;
  if (stages?.nextId) {
    warning = await moveAsConsequence(
      actor,
      cardId,
      stages.nextId,
      card.organization_id,
      "prioritized",
    );
  }

  revalidatePath("/prioridades");
  revalidatePath("/board");
  return warning
    ? { ok: true, warning: `Prioridade registrada, mas o card não avançou: ${warning}` }
    : { ok: true };
}

/** Remove a priorização (arquiva — preserva o histórico). */
export async function deprioritizeCard(
  cardId: string,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const actor = await requireActor("card:update");
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id, board_id, stage_id")
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

  // Simétrico ao avanço: sem prioridade, a demanda não pode ficar adiante do
  // checkpoint — volta para lá e espera ser priorizada de novo. Quem já estava
  // atrás do checkpoint fica onde está.
  let warning: string | null = null;
  const stages = await prioritizationStages(db, card.board_id);
  if (stages) {
    const atual = stages.posOf.get(card.stage_id);
    const cp = stages.posOf.get(stages.checkpointId);
    if (atual != null && cp != null && atual > cp) {
      warning = await moveAsConsequence(
        actor,
        cardId,
        stages.checkpointId,
        card.organization_id,
        "deprioritized",
      );
    }
  }

  revalidatePath("/prioridades");
  revalidatePath("/board");
  return warning
    ? { ok: true, warning: `Prioridade removida, mas o card não voltou: ${warning}` }
    : { ok: true };
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
