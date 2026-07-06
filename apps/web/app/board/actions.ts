"use server";

import { buildCardCode } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxonomyOption } from "@/lib/board/types";

/**
 * Cria um card na 1ª etapa só com o nome (título). O #number (ID sequencial por
 * quadro) é atribuído por trigger no banco; a taxonomia e o código ficam para a
 * equipe preencher depois, no detalhe do card.
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

/** Opções de taxonomia para o editor do detalhe. */
export async function loadTaxonomyOptions(): Promise<{
  materias: TaxonomyOption[];
  series: TaxonomyOption[];
}> {
  const db = createAdminClient();
  const [m, s] = await Promise.all([
    db.from("materia").select("id, name, code").order("position"),
    db.from("serie").select("id, name, code").order("position"),
  ]);
  return {
    materias: (m.data ?? []).map((x) => ({ id: x.id, name: x.name, code: x.code })),
    series: (s.data ?? []).map((x) => ({ id: x.id, name: x.name, code: x.code })),
  };
}

export interface UpdateCardInput {
  id: string;
  title?: string;
  materiaId?: string | null;
  serieId?: string | null;
  bimestre?: number | null;
}

/**
 * Atualiza nome e/ou taxonomia. Quando matéria + série + bimestre ficam
 * completos, gera o `code` (e preenche segmento/ano a partir do board).
 */
export async function updateCard(input: UpdateCardInput): Promise<void> {
  const db = createAdminClient();

  const { data: card } = await db
    .from("card")
    .select("id, board_id, materia_id, serie_id, bimestre")
    .eq("id", input.id)
    .single();
  if (!card) throw new Error("Card não encontrado.");

  const materiaId = input.materiaId !== undefined ? input.materiaId : card.materia_id;
  const serieId = input.serieId !== undefined ? input.serieId : card.serie_id;
  const bimestre = input.bimestre !== undefined ? input.bimestre : card.bimestre;

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim() || "Novo card";
  if (input.materiaId !== undefined) patch.materia_id = input.materiaId;
  if (input.serieId !== undefined) patch.serie_id = input.serieId;
  if (input.bimestre !== undefined) patch.bimestre = input.bimestre;

  if (materiaId && serieId && bimestre != null) {
    const { data: board } = await db
      .from("board")
      .select("segmento_id, ano_letivo_id")
      .eq("id", card.board_id)
      .single();
    if (board) {
      const [mat, ser, seg, ano] = await Promise.all([
        db.from("materia").select("code").eq("id", materiaId).single(),
        db.from("serie").select("code").eq("id", serieId).single(),
        db.from("segmento").select("code").eq("id", board.segmento_id).single(),
        db.from("ano_letivo").select("year").eq("id", board.ano_letivo_id).single(),
      ]);
      if (mat.data && ser.data && seg.data && ano.data) {
        patch.segmento_id = board.segmento_id;
        patch.ano_letivo_id = board.ano_letivo_id;
        patch.code = buildCardCode({
          materiaCode: mat.data.code,
          serieCode: ser.data.code,
          segmentoCode: seg.data.code,
          bimestre: bimestre as 0 | 1 | 2 | 3 | 4,
          year: ano.data.year,
        });
      }
    }
  }

  const { error } = await db.from("card").update(patch).eq("id", input.id);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}
