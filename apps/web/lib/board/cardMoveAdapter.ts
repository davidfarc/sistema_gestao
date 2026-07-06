import type { CardFacts, CardMovePort, WorkflowRule } from "@ecco/core";

import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

function mapRule(r: {
  id: string;
  organization_id: string;
  board_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
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

  return {
    checklistComplete,
    hasAttachment: (attachCount ?? 0) > 0,
    filledFieldIds,
    hasConcludedEmenda,
    hasApproval: false, // TODO: tabela approval
    actorHasRole: () => false, // TODO: gates por papel
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
        .eq("to_stage_id", toStageId)
        .eq("is_active", true);
      return (data ?? [])
        .filter((r) => r.from_stage_id === null || r.from_stage_id === fromStageId)
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
