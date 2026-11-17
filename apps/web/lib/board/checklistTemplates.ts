"use server";

import type { Actor } from "@ecco/core";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { copyTemplatesToCard } from "./checklistCopy";
import { assertBoardScope, assertCardScope, assertChecklistScope } from "./scope";
import type { ChecklistTemplate } from "./types";

/**
 * Modelos de checklist (migration 0045): cada pipeline tem os seus. A gestão do
 * pipeline (`stage:manage` + enxergar o pipeline) cria, edita e exclui; quem
 * edita o card (`card:update`) usa. Usar um modelo copia os itens para o card.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_ITEMS = 200;

function friendly(message: string): string {
  return message.includes("checklist_template")
    ? "Falta aplicar a atualização do banco (migration 0045)."
    : "Não foi possível salvar. Tente de novo.";
}

function cleanItems(items: string[]): string[] {
  return items.map((t) => t.trim()).filter(Boolean).slice(0, MAX_ITEMS);
}

async function requireBoardManager(boardId: string): Promise<Actor> {
  const actor = await requireActor("stage:manage");
  await assertBoardScope(actor, boardId);
  return actor;
}

/** Modelos do pipeline. `available: false` = migration ainda não aplicada. */
export async function loadChecklistTemplates(
  boardId: string,
): Promise<{ templates: ChecklistTemplate[]; available: boolean; canManage: boolean }> {
  const actor = await requireActor();
  const db = await createClient(); // sessão → RLS: só de pipelines que a pessoa enxerga
  const { data, error } = await db
    .from("checklist_template")
    .select("id, name, items")
    .eq("board_id", boardId)
    .order("name");
  if (error) return { templates: [], available: false, canManage: false };
  // Gestão = `stage:manage` num pipeline que ela enxerga (o RLS responde isso).
  const { data: board } = await db.from("board").select("id").eq("id", boardId).maybeSingle();
  return {
    templates: (data ?? []).map((t) => ({ id: t.id, name: t.name, items: (t.items ?? []) as string[] })),
    available: true,
    canManage: !!board && actor.permissions.has("stage:manage"),
  };
}

/** Guarda um checklist de um card como modelo do pipeline dele. */
export async function saveChecklistAsTemplate(checklistId: string): Promise<Result> {
  const actor = await requireActor("stage:manage");
  await assertChecklistScope(actor, checklistId);
  const db = createAdminClient();
  const { data: list } = await db
    .from("checklist")
    .select("name, card_id, organization_id")
    .eq("id", checklistId)
    .maybeSingle();
  if (!list) return { ok: false, error: "Checklist não encontrado." };
  const { data: card } = await db.from("card").select("board_id").eq("id", list.card_id).maybeSingle();
  if (!card) return { ok: false, error: "Card não encontrado." };
  await assertBoardScope(actor, card.board_id);
  const { data: items } = await db
    .from("checklist_item")
    .select("text, position")
    .eq("checklist_id", checklistId)
    .order("position");
  const texts = cleanItems((items ?? []).map((i) => i.text));
  if (texts.length === 0) return { ok: false, error: "Adicione ao menos um item antes de salvar como modelo." };
  const { error } = await db.from("checklist_template").insert({
    organization_id: list.organization_id,
    board_id: card.board_id,
    name: list.name,
    items: texts,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function updateChecklistTemplate(id: string, name: string, items: string[]): Promise<Result> {
  const db = createAdminClient();
  const { data: tpl } = await db.from("checklist_template").select("board_id").eq("id", id).maybeSingle();
  if (!tpl) return { ok: false, error: "Modelo não encontrado." };
  await requireBoardManager(tpl.board_id);
  const texts = cleanItems(items);
  if (!name.trim()) return { ok: false, error: "Dê um nome ao modelo." };
  if (texts.length === 0) return { ok: false, error: "O modelo precisa de ao menos um item." };
  const { error } = await db
    .from("checklist_template")
    .update({ name: name.trim(), items: texts, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function deleteChecklistTemplate(id: string): Promise<Result> {
  const db = createAdminClient();
  const { data: tpl } = await db.from("checklist_template").select("board_id").eq("id", id).maybeSingle();
  if (!tpl) return { ok: true };
  await requireBoardManager(tpl.board_id);
  const { error } = await db.from("checklist_template").delete().eq("id", id);
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

/** Usa um modelo num card que já existe. */
export async function applyChecklistTemplate(cardId: string, templateId: string): Promise<Result> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const [{ data: card }, { data: tpl }] = await Promise.all([
    db.from("card").select("board_id").eq("id", cardId).maybeSingle(),
    db.from("checklist_template").select("board_id").eq("id", templateId).maybeSingle(),
  ]);
  if (!card || !tpl || card.board_id !== tpl.board_id) {
    return { ok: false, error: "Modelo não encontrado neste pipeline." };
  }
  await copyTemplatesToCard(cardId, [templateId]);
  return { ok: true };
}
