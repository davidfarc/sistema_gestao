import type { CardFacts, CardMovePort, WorkflowRule } from "@ecco/core";

import { DF } from "@/lib/demandas/fields";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Campos que precisam estar preenchidos para o RICE fechar. O esforço agora vem
 * de tempo + complexidade + orçamento (este último derivado do valor da demanda,
 * que também é exigido).
 */
const RICE_FIELDS = [
  DF.riceAlcance,
  DF.riceImpacto,
  DF.riceConfianca,
  DF.riceTempo,
  DF.riceComplexidade,
  DF.orcamento,
];

function mapRule(r: {
  id: string;
  organization_id: string;
  board_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  requirement: string;
  requirement_config: Record<string, unknown> | null;
  enforcement: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}): WorkflowRule {
  return {
    id: r.id,
    organizationId: r.organization_id,
    boardId: r.board_id,
    fromStageId: r.from_stage_id,
    toStageId: r.to_stage_id,
    requirement: r.requirement,
    requirementConfig: r.requirement_config ?? {},
    enforcement: r.enforcement,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  } as WorkflowRule;
}

async function gatherFacts(db: Db, cardId: string): Promise<CardFacts> {
  const { data: lists } = await db.from("checklist").select("id").eq("card_id", cardId);
  const listIds = (lists ?? []).map((l) => l.id);

  let checklistComplete = false;
  if (listIds.length > 0) {
    const { data: items } = await db
      .from("checklist_item")
      .select("done")
      .in("checklist_id", listIds);
    const all = items ?? [];
    checklistComplete = all.length > 0 && all.every((i) => i.done);
  }

  const { count: attachCount } = await db
    .from("attachment")
    .select("id", { count: "exact", head: true })
    .eq("card_id", cardId);

  const { data: emendas } = await db.from("emenda").select("status").eq("card_id", cardId);
  const hasConcludedEmenda = (emendas ?? []).some((e) => e.status === "concluida");

  const { data: fvs } = await db
    .from("field_value")
    .select("field_definition_id, value_text, value_number, value_date, value_bool, value_member_id, value_json")
    .eq("card_id", cardId);
  const filledFieldIds = new Set<string>(
    (fvs ?? [])
      .filter(
        (v) =>
          v.value_text != null ||
          v.value_number != null ||
          v.value_date != null ||
          v.value_bool != null ||
          v.value_member_id != null ||
          v.value_json != null,
      )
      .map((v) => v.field_definition_id),
  );

  // Priorizada = ato explícito na fila (linha viva) E RICE completo. Revalidar o
  // RICE aqui cobre o caso de alguém limpar os campos depois de priorizar.
  let isPrioritized = false;
  const { data: live } = await db
    .from("prioritization")
    .select("id, board_id")
    .eq("card_id", cardId)
    .is("archived_at", null)
    .maybeSingle();
  if (live) {
    const { data: riceFields } = await db
      .from("field_definition")
      .select("id")
      .or(`board_id.eq.${live.board_id},board_id.is.null`)
      .in("name", RICE_FIELDS);
    const ids = (riceFields ?? []).map((f) => f.id);
    isPrioritized = ids.length === RICE_FIELDS.length && ids.every((id) => filledFieldIds.has(id));
  }

  return {
    checklistComplete,
    hasAttachment: (attachCount ?? 0) > 0,
    filledFieldIds,
    hasConcludedEmenda,
    hasApproval: false, // TODO: tabela approval
    actorHasRole: () => false, // TODO: gates por papel
    isPrioritized,
  };
}

/** Implementa CardMovePort sobre o Supabase (client admin — dev). */
export function createSupabaseMovePort(): CardMovePort {
  const db = createAdminClient();
  return {
    async getCard(cardId) {
      const { data } = await db
        .from("card")
        .select("board_id, stage_id")
        .eq("id", cardId)
        .maybeSingle();
      return data ? { boardId: data.board_id, stageId: data.stage_id } : null;
    },
    async stageInBoard(stageId, boardId) {
      const { data } = await db
        .from("stage")
        .select("id")
        .eq("id", stageId)
        .eq("board_id", boardId)
        .maybeSingle();
      return Boolean(data);
    },
    async listRules(boardId, fromStageId, toStageId) {
      const { data } = await db
        .from("workflow_rule")
        .select("*")
        .eq("board_id", boardId)
        .eq("is_active", true);
      const rules = data ?? [];

      // `prioritized` é posicional: vale ao avançar para ALÉM do checkpoint —
      // pegando tanto quem pula a etapa quanto quem tenta sair dela. Voltar
      // para trás continua livre.
      let posOf: Map<string, number> | null = null;
      if (rules.some((r) => r.requirement === "prioritized")) {
        const { data: stages } = await db
          .from("stage")
          .select("id, position")
          .eq("board_id", boardId);
        posOf = new Map((stages ?? []).map((s) => [s.id, Number(s.position)]));
      }

      return rules
        .filter((r) => {
          if (r.requirement === "prioritized") {
            const checkpoint = (r.requirement_config as { checkpointStageId?: string } | null)
              ?.checkpointStageId;
            if (!checkpoint || !posOf) return false;
            const to = posOf.get(toStageId);
            const check = posOf.get(checkpoint);
            return to != null && check != null && to > check;
          }
          const toOk = r.to_stage_id === null || r.to_stage_id === toStageId;
          const fromOk = r.from_stage_id === null || r.from_stage_id === fromStageId;
          return toOk && fromOk;
        })
        .map(mapRule);
    },
    async getFacts(cardId) {
      return gatherFacts(db, cardId);
    },
    async applyMove(cardId, toStageId, enteredAtIso) {
      const { error } = await db
        .from("card")
        .update({ stage_id: toStageId, stage_entered_at: enteredAtIso })
        .eq("id", cardId);
      if (error) throw new Error(error.message);
    },
  };
}
