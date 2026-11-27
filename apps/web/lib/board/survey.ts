"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pesquisa de satisfação depois da reunião (migration 0062), por pipeline.
 * Só quem configura pipelines (`board:configure`) lê e altera.
 */

export interface BoardSurvey {
  enabled: boolean;
  triggerStageId: string;
  waitingStageId: string;
  doneStageId: string;
  phoneFieldId: string;
  nameFieldId: string;
  confirmerIds: string[];
}

export interface BoardSurveyChoices {
  stages: { id: string; name: string }[];
  fields: { id: string; name: string }[];
  people: { id: string; name: string; hasPhone: boolean }[];
}

const PENDING = "Falta aplicar a atualização do banco (migration 0062).";
const EMPTY: BoardSurvey = {
  enabled: false,
  triggerStageId: "",
  waitingStageId: "",
  doneStageId: "",
  phoneFieldId: "",
  nameFieldId: "",
  confirmerIds: [],
};

export async function loadBoardSurvey(
  boardId: string,
): Promise<{ ok: true; value: BoardSurvey; choices: BoardSurveyChoices } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const org = actor.organizationId as string;
  const db = createAdminClient();
  const { data: board, error } = await db.from("board").select("*").eq("id", boardId).eq("organization_id", org).maybeSingle();
  if (error || !board) return { ok: false, error: "Pipeline não encontrado." };
  const raw = board as unknown as { survey_config?: Record<string, unknown> | null };
  if (raw.survey_config === undefined) return { ok: false, error: PENDING };

  const [{ data: stages }, { data: fields }, { data: users }, { data: phones }] = await Promise.all([
    db.from("stage").select("id, name").eq("board_id", boardId).order("position"),
    db
      .from("field_definition")
      .select("id, name, type")
      .eq("board_id", boardId)
      .is("archived_at", null)
      .in("type", ["text", "number", "long_text"])
      .order("position"),
    db.from("app_user").select("id, name, email").eq("organization_id", org).eq("is_internal", true).is("archived_at", null).order("name"),
    db.from("user_phone").select("user_id"),
  ]);
  const withPhone = new Set((phones ?? []).map((p) => p.user_id as string));
  const cfg = raw.survey_config ?? {};
  const str = (k: string) => (typeof cfg[k] === "string" ? (cfg[k] as string) : "");
  return {
    ok: true,
    value: {
      enabled: cfg.enabled === true,
      triggerStageId: str("trigger_stage_id"),
      waitingStageId: str("waiting_stage_id"),
      doneStageId: str("done_stage_id"),
      phoneFieldId: str("phone_field_id"),
      nameFieldId: str("name_field_id"),
      confirmerIds: Array.isArray(cfg.confirmer_ids) ? (cfg.confirmer_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
    },
    choices: {
      stages: (stages ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
      fields: (fields ?? []).map((f) => ({ id: f.id as string, name: f.name as string })),
      people: (users ?? []).map((u) => ({
        id: u.id as string,
        name: (u.name as string) || (u.email as string),
        hasPhone: withPhone.has(u.id as string),
      })),
    },
  };
}

export async function setBoardSurvey(
  boardId: string,
  value: BoardSurvey,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const org = actor.organizationId as string;
  const db = createAdminClient();

  let config: Record<string, unknown> | null = null;
  if (value.enabled) {
    const stageIds = [value.triggerStageId, value.waitingStageId, value.doneStageId];
    if (stageIds.some((s) => !s)) return { ok: false, error: "Escolha as três etapas da pesquisa." };
    if (new Set(stageIds).size !== 3) return { ok: false, error: "As três etapas da pesquisa precisam ser diferentes." };
    if (!value.phoneFieldId) return { ok: false, error: "Escolha a propriedade com o telefone do participante." };
    if (value.confirmerIds.length === 0) return { ok: false, error: "Escolha quem confirma o telefone." };

    // Tudo precisa ser deste pipeline e desta organização.
    const [{ data: stages }, { data: fields }, { data: users }] = await Promise.all([
      db.from("stage").select("id").eq("board_id", boardId).in("id", stageIds),
      db.from("field_definition").select("id").eq("board_id", boardId).in("id", [value.phoneFieldId, value.nameFieldId].filter(Boolean)),
      db.from("app_user").select("id").eq("organization_id", org).eq("is_internal", true).is("archived_at", null).in("id", value.confirmerIds),
    ]);
    if ((stages ?? []).length !== 3) return { ok: false, error: "Etapa inválida." };
    if ((fields ?? []).length !== [value.phoneFieldId, value.nameFieldId].filter(Boolean).length) {
      return { ok: false, error: "Propriedade inválida." };
    }
    if ((users ?? []).length !== value.confirmerIds.length) return { ok: false, error: "Pessoa inválida." };

    config = {
      enabled: true,
      trigger_stage_id: value.triggerStageId,
      waiting_stage_id: value.waitingStageId,
      done_stage_id: value.doneStageId,
      phone_field_id: value.phoneFieldId,
      name_field_id: value.nameFieldId || null,
      confirmer_ids: value.confirmerIds,
    };
  }
  const { error } = await db
    .from("board")
    .update({ survey_config: config } as never)
    .eq("id", boardId)
    .eq("organization_id", org);
  if (error) return { ok: false, error: error.message.includes("survey_config") ? PENDING : "Não foi possível salvar. Tente de novo." };
  return { ok: true };
}
