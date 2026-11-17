"use server";

import { formatPhone, normalizePhone } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Telefone do usuário (migration 0044): a chave que o agente do WhatsApp usa
 * para reconhecer quem escreve. Cada pessoa edita o próprio; quem gerencia
 * usuários edita o de qualquer um.
 */

type Result = { ok: true; phone: string | null } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("user_phone_phone_idx") || message.includes("duplicate")) {
    return "Este telefone já está cadastrado para outra pessoa.";
  }
  if (message.includes("user_phone")) return "Falta aplicar a atualização do banco (migration 0044).";
  return "Não foi possível salvar. Tente de novo.";
}

async function save(userId: string, organizationId: string, raw: string): Promise<Result> {
  const db = createAdminClient();
  if (!raw.trim()) {
    const { error } = await db.from("user_phone").delete().eq("user_id", userId);
    return error ? { ok: false, error: friendly(error.message) } : { ok: true, phone: null };
  }
  const phone = normalizePhone(raw);
  if (!phone) {
    return { ok: false, error: "Não entendi o número. Escreva com o DDD, por exemplo (84) 99999-8888." };
  }
  const { error } = await db
    .from("user_phone")
    .upsert(
      { user_id: userId, organization_id: organizationId, phone, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, phone: formatPhone(phone) };
}

/** Meu telefone, já formatado; null se não há (ou se a migration ainda não foi aplicada). */
export async function loadMyPhone(): Promise<{ phone: string | null; available: boolean }> {
  const actor = await requireActor();
  const { data, error } = await createAdminClient()
    .from("user_phone")
    .select("phone")
    .eq("user_id", actor.userId as string)
    .maybeSingle();
  if (error) return { phone: null, available: false };
  return { phone: data ? formatPhone(data.phone) : null, available: true };
}

export async function setMyPhone(raw: string): Promise<Result> {
  const actor = await requireActor();
  return save(actor.userId as string, actor.organizationId as string, raw);
}

/** Gestão: grava o telefone de outra pessoa da organização. */
export async function setUserPhone(userId: string, raw: string): Promise<Result> {
  const actor = await requireActor("user:manage");
  const { data: user } = await createAdminClient()
    .from("app_user")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  if (!user || user.organization_id !== (actor.organizationId as string)) {
    return { ok: false, error: "Usuário não encontrado." };
  }
  const res = await save(userId, actor.organizationId as string, raw);
  if (res.ok) revalidatePath("/configuracoes/usuarios");
  return res;
}
