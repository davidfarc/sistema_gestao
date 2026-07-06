"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cria um card na 1ª etapa só com o nome (título). O #number (ID sequencial por
 * quadro) é atribuído por trigger no banco; a taxonomia (matéria/série/bimestre)
 * e o código ficam para a equipe preencher depois, no detalhe do card.
 */
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

/** Move um card de etapa (persiste). TODO: passar por CardService.move (gates). */
export async function moveCard(cardId: string, toStageId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("card")
    .update({ stage_id: toStageId, stage_entered_at: new Date().toISOString() })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}
