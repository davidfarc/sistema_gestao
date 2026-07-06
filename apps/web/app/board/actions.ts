"use server";

import {
  CardService,
  GateBlockedError,
  asId,
  type Action,
  type Actor,
  type RuleViolation,
} from "@ecco/core";
import { revalidatePath } from "next/cache";

import { createSupabaseMovePort } from "@/lib/board/cardMoveAdapter";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AttachmentView, ChecklistItemView, ChecklistView } from "@/lib/board/types";

/** Ator de sistema (dev, sem auth). Quando o login entrar, usar o ator real. */
const SYSTEM_ACTOR: Actor = {
  userId: asId("system"),
  organizationId: asId("system"),
  isInternal: true,
  permissions: new Set<Action>(["card:move"]),
  teamIds: [],
};

// ── Cards ────────────────────────────────────────────────────────────────────

/** Cria um card na 1ª etapa só com o nome. O #number vem por trigger no banco. */
export async function createCard(title: string): Promise<void> {
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, organization_id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!board) throw new Error("Nenhum board encontrado.");

  const { data: firstStage } = await db
    .from("stage")
    .select("id")
    .eq("board_id", board.id)
    .order("position")
    .limit(1)
    .single();
  if (!firstStage) throw new Error("Board sem etapas.");

  const { error } = await db.from("card").insert({
    organization_id: board.organization_id,
    board_id: board.id,
    stage_id: firstStage.id,
    title: title.trim() || "Novo card",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Move um card de etapa PELO CardService — avalia os gates (workflow_rules) no
 * servidor. Se um gate block barrar, retorna { ok:false, reason } (não move).
 */
export async function moveCard(
  cardId: string,
  toStageId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const service = new CardService(createSupabaseMovePort(), () => new Date().toISOString());
  try {
    await service.move(SYSTEM_ACTOR, cardId, toStageId);
    revalidatePath("/board");
    return { ok: true };
  } catch (e) {
    if (e instanceof GateBlockedError) {
      const violations = (e.details ?? []) as RuleViolation[];
      return { ok: false, reason: violations[0]?.message ?? "Transição bloqueada." };
    }
    throw e;
  }
}

/** Renomeia o card. */
export async function updateCard(input: { id: string; title: string }): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("card")
    .update({ title: input.title.trim() || "Novo card" })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

// ── Checklists ───────────────────────────────────────────────────────────────

export async function loadChecklists(cardId: string): Promise<ChecklistView[]> {
  const db = createAdminClient();
  const { data: lists } = await db
    .from("checklist")
    .select("id, name, position")
    .eq("card_id", cardId)
    .order("position");
  if (!lists || lists.length === 0) return [];

  const { data: items } = await db
    .from("checklist_item")
    .select("id, checklist_id, text, done, position")
    .in(
      "checklist_id",
      lists.map((l) => l.id),
    )
    .order("position");

  const byList = new Map<string, ChecklistItemView[]>();
  for (const it of items ?? []) {
    const arr = byList.get(it.checklist_id) ?? [];
    arr.push({ id: it.id, text: it.text, done: it.done, position: Number(it.position) });
    byList.set(it.checklist_id, arr);
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    position: Number(l.position),
    items: byList.get(l.id) ?? [],
  }));
}

async function nextPosition(
  db: ReturnType<typeof createAdminClient>,
  table: "checklist" | "checklist_item",
  column: "card_id" | "checklist_id",
  value: string,
): Promise<number> {
  const { data } = await db
    .from(table)
    .select("position")
    .eq(column, value)
    .order("position", { ascending: false })
    .limit(1);
  const top = data?.[0];
  return top ? Number(top.position) + 1 : 0;
}

export async function addChecklist(cardId: string, name: string): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const position = await nextPosition(db, "checklist", "card_id", cardId);
  const { error } = await db.from("checklist").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    name: name.trim() || "Checklist",
    position,
  });
  if (error) throw new Error(error.message);
}

export async function addChecklistItem(checklistId: string, text: string): Promise<void> {
  const db = createAdminClient();
  const position = await nextPosition(db, "checklist_item", "checklist_id", checklistId);
  const { error } = await db
    .from("checklist_item")
    .insert({ checklist_id: checklistId, text: text.trim(), position });
  if (error) throw new Error(error.message);
}

export async function setChecklistItemDone(itemId: string, done: boolean): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("checklist_item").update({ done }).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("checklist_item").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("checklist").delete().eq("id", checklistId);
  if (error) throw new Error(error.message);
}

// ── Anexos (qualquer link clicável) ──────────────────────────────────────────

function normalizeUrl(url: string): string {
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function loadAttachments(cardId: string): Promise<AttachmentView[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("attachment")
    .select("id, label, url")
    .eq("card_id", cardId)
    .order("created_at");
  return (data ?? []).map((a) => ({ id: a.id, label: a.label, url: a.url }));
}

export async function addAttachment(
  cardId: string,
  url: string,
  label: string,
): Promise<void> {
  const db = createAdminClient();
  if (!url.trim()) throw new Error("Informe um link.");
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const { error } = await db.from("attachment").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    kind: "link",
    url: normalizeUrl(url),
    label: label.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("attachment").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
