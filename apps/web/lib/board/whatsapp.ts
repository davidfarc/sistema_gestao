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
}

const MAX_INSTRUCTIONS = 6000;
const PENDING = "Falta aplicar a atualização do banco (migration 0050).";

export async function loadBoardWhatsapp(
  boardId: string,
): Promise<{ ok: true; value: BoardWhatsapp } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const { data, error } = await createAdminClient()
    .from("board")
    .select("whatsapp_enabled, whatsapp_instructions")
    .eq("id", boardId)
    .eq("organization_id", actor.organizationId as string)
    .maybeSingle();
  if (error) return { ok: false, error: PENDING };
  if (!data) return { ok: false, error: "Pipeline não encontrado." };
  const row = data as unknown as { whatsapp_enabled: boolean | null; whatsapp_instructions: string | null };
  return { ok: true, value: { enabled: row.whatsapp_enabled === true, instructions: row.whatsapp_instructions ?? "" } };
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
  const { error } = await createAdminClient()
    .from("board")
    .update({ whatsapp_enabled: !!value.enabled, whatsapp_instructions: instructions } as never)
    .eq("id", boardId)
    .eq("organization_id", actor.organizationId as string);
  if (error) return { ok: false, error: error.message.includes("whatsapp") ? PENDING : "Não foi possível salvar. Tente de novo." };
  return { ok: true };
}
