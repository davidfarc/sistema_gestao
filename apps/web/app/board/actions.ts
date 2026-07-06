"use server";

import { buildCardCode } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

export interface NewCardInput {
  materiaId: string;
  serieId: string;
  bimestre: 0 | 1 | 2 | 3 | 4;
  title: string;
}

/**
 * Cria um card na 1ª etapa do board. O #number (ID sequencial por quadro) é
 * atribuído por trigger no banco; o `code` é gerado da taxonomia pelo @ecco/core.
 */
export async function createCard(input: NewCardInput): Promise<void> {
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, organization_id, segmento_id, ano_letivo_id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!board) throw new Error("Nenhum board encontrado.");

  const [materiaRes, serieRes, segmentoRes, anoRes, stageRes] = await Promise.all([
    db.from("materia").select("code").eq("id", input.materiaId).single(),
    db.from("serie").select("code").eq("id", input.serieId).single(),
    db.from("segmento").select("code").eq("id", board.segmento_id).single(),
    db.from("ano_letivo").select("year").eq("id", board.ano_letivo_id).single(),
    db.from("stage").select("id").eq("board_id", board.id).order("position").limit(1).single(),
  ]);

  const materiaCode = materiaRes.data?.code;
  const serieCode = serieRes.data?.code;
  const segmentoCode = segmentoRes.data?.code;
  const year = anoRes.data?.year;
  const firstStageId = stageRes.data?.id;
  if (!materiaCode || !serieCode || !segmentoCode || !year || !firstStageId) {
    throw new Error("Taxonomia incompleta para gerar o card.");
  }

  const code = buildCardCode({
    materiaCode,
    serieCode,
    segmentoCode,
    bimestre: input.bimestre,
    year,
  });

  const bim = input.bimestre === 0 ? "anual" : `${input.bimestre}º bim`;
  const title =
    input.title.trim() || `${materiaCode} — ${serieCode} — ${bim}`;

  const { error } = await db.from("card").insert({
    organization_id: board.organization_id,
    board_id: board.id,
    materia_id: input.materiaId,
    serie_id: input.serieId,
    segmento_id: board.segmento_id,
    bimestre: input.bimestre,
    ano_letivo_id: board.ano_letivo_id,
    stage_id: firstStageId,
    code,
    title,
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
