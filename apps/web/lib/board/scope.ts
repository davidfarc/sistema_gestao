import "server-only";

import { NotFoundError, type Actor } from "@ecco/core";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Escopo das escritas: a ação só vale se a pessoa ENXERGA o pipeline (ou o
 * card) em que está mexendo. A permissão do papel diz O QUE ela pode fazer;
 * isto diz ONDE. Quem decide é o mesmo RLS que filtra as telas (`can_see_board`,
 * `can_see_card`), consultado pela sessão: Gestor de área e Membro interno só
 * nos pipelines em que são membros; o solicitante no card que pediu.
 *
 * Fora do escopo responde "não encontrado" (não revela que o item existe).
 *
 * Quem tem `board:configure` (Gestor e Gestor Master) enxerga todos os
 * pipelines da organização: a consulta é pulada.
 */

function seesAll(actor: Actor): boolean {
  return actor.isInternal && actor.permissions.has("board:configure");
}

export async function assertCardScope(actor: Actor, cardId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await (await createClient()).from("card").select("id").eq("id", cardId).maybeSingle();
  if (!data) throw new NotFoundError("Card não encontrado.");
}

export async function assertBoardScope(actor: Actor, boardId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await (await createClient()).from("board").select("id").eq("id", boardId).maybeSingle();
  if (!data) throw new NotFoundError("Pipeline não encontrado.");
}

/** Etapa: vale o pipeline dela (não a exceção do solicitante). */
export async function assertStageScope(actor: Actor, stageId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await createAdminClient().from("stage").select("board_id").eq("id", stageId).maybeSingle();
  if (!data) throw new NotFoundError("Etapa não encontrada.");
  await assertBoardScope(actor, data.board_id);
}

/** Propriedade: as globais (sem pipeline) valem para a organização toda. */
export async function assertFieldScope(actor: Actor, fieldId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await createAdminClient()
    .from("field_definition")
    .select("board_id")
    .eq("id", fieldId)
    .maybeSingle();
  if (!data) throw new NotFoundError("Propriedade não encontrada.");
  if (data.board_id) await assertBoardScope(actor, data.board_id);
}

export async function assertChecklistScope(actor: Actor, checklistId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await createAdminClient().from("checklist").select("card_id").eq("id", checklistId).maybeSingle();
  if (!data) throw new NotFoundError("Checklist não encontrado.");
  await assertCardScope(actor, data.card_id);
}

export async function assertChecklistItemScope(actor: Actor, itemId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await createAdminClient()
    .from("checklist_item")
    .select("checklist_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!data) throw new NotFoundError("Item não encontrado.");
  await assertChecklistScope(actor, data.checklist_id);
}

export async function assertAttachmentScope(actor: Actor, attachmentId: string): Promise<void> {
  if (seesAll(actor)) return;
  const { data } = await createAdminClient().from("attachment").select("card_id").eq("id", attachmentId).maybeSingle();
  if (!data) throw new NotFoundError("Anexo não encontrado.");
  await assertCardScope(actor, data.card_id);
}
