"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Atendimento pelo WhatsApp, por pipeline (SPEC-FASE2 §C.2, migration 0050):
 * liga o agente e guarda as instruções que ele segue. Só quem configura
 * pipelines (`board:configure`) lê e altera.
 */

export interface BoardWhatsapp {
  enabled: boolean;
  instructions: string;
  /** Pedido novo só sai da 1ª etapa pelas mãos da gestão (0052). */
  releaseRequired: boolean;
  /** Dias sem novidade até lembrar o responsável; 0 desliga (0052). */
  reminderDays: number;
  /** Guardar fotos e descrição de cada card numa pasta do Google Drive (0056). */
  driveArchive: boolean;
}

const MAX_INSTRUCTIONS = 6000;
const PENDING = "Falta aplicar a atualização do banco (migration 0050).";

export async function loadBoardWhatsapp(
  boardId: string,
): Promise<{ ok: true; value: BoardWhatsapp } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const { data, error } = await createAdminClient()
    .from("board")
    .select("*")
    .eq("id", boardId)
    .eq("organization_id", actor.organizationId as string)
    .maybeSingle();
  if (error) return { ok: false, error: PENDING };
  if (!data) return { ok: false, error: "Pipeline não encontrado." };
  const row = data as unknown as {
    whatsapp_enabled?: boolean | null;
    whatsapp_instructions?: string | null;
    release_required?: boolean | null;
    whatsapp_reminder_days?: number | null;
    drive_archive?: boolean | null;
  };
  if (row.whatsapp_enabled === undefined) return { ok: false, error: PENDING };
  return {
    ok: true,
    value: {
      enabled: row.whatsapp_enabled === true,
      instructions: row.whatsapp_instructions ?? "",
      releaseRequired: row.release_required === true,
      reminderDays: Number(row.whatsapp_reminder_days ?? 3),
      driveArchive: row.drive_archive === true,
    },
  };
}

export async function setBoardWhatsapp(
  boardId: string,
  value: BoardWhatsapp,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const instructions = String(value.instructions ?? "").trim();
  if (instructions.length > MAX_INSTRUCTIONS) {
    return { ok: false, error: `As instruções passam de ${MAX_INSTRUCTIONS} caracteres. Resuma um pouco.` };
  }
  const days = Math.min(60, Math.max(0, Math.floor(Number(value.reminderDays) || 0)));
  const { error } = await createAdminClient()
    .from("board")
    .update({
      whatsapp_enabled: !!value.enabled,
      whatsapp_instructions: instructions,
      release_required: !!value.releaseRequired,
      whatsapp_reminder_days: days,
    } as never)
    .eq("id", boardId)
    .eq("organization_id", actor.organizationId as string);
  if (error) {
    const missing = error.message.includes("release_required") || error.message.includes("reminder_days");
    return {
      ok: false,
      error: missing
        ? "Falta aplicar a atualização do banco (migration 0052)."
        : error.message.includes("whatsapp")
          ? PENDING
          : "Não foi possível salvar. Tente de novo.",
    };
  }
  // Coluna da 0056, gravada à parte: sem a migration, o resto já ficou salvo.
  if (value.driveArchive !== undefined) {
    const { error: driveError } = await createAdminClient()
      .from("board")
      .update({ drive_archive: !!value.driveArchive } as never)
      .eq("id", boardId)
      .eq("organization_id", actor.organizationId as string);
    if (driveError && value.driveArchive) {
      return { ok: false, error: "Falta aplicar a atualização do banco (migration 0056) para guardar no Drive." };
    }
  }
  return { ok: true };
}
