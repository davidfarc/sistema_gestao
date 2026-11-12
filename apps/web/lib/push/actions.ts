"use server";

import { headers } from "next/headers";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedPushEndpoint, sendPush, vapidKeys } from "./send";

/** Chave pública para o navegador se inscrever. `null` = push ainda não configurado. */
export async function getPushPublicKey(): Promise<string | null> {
  await requireActor();
  return vapidKeys()?.publicKey ?? null;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Guarda a inscrição deste aparelho para a pessoa logada. */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor();
  const { endpoint, p256dh, auth } = input ?? ({} as typeof input);
  if (
    typeof endpoint !== "string" ||
    endpoint.length > 2000 ||
    !isAllowedPushEndpoint(endpoint) ||
    typeof p256dh !== "string" ||
    !B64URL.test(p256dh) ||
    p256dh.length > 200 ||
    typeof auth !== "string" ||
    !B64URL.test(auth) ||
    auth.length > 100
  ) {
    return { ok: false, error: "Este navegador devolveu uma inscrição que o sistema não reconhece." };
  }
  const db = createAdminClient();
  // Mesmo aparelho, outra pessoa logada: a inscrição passa a ser de quem ativou agora.
  const { error } = await db.from("push_subscription").upsert(
    {
      organization_id: actor.organizationId as string,
      user_id: actor.userId as string,
      endpoint,
      p256dh,
      auth,
      user_agent: ((await headers()).get("user-agent") ?? "").slice(0, 300) || null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, error: "Não foi possível salvar. Tente de novo." };
  return { ok: true };
}

/** Remove a inscrição deste aparelho (só a da própria pessoa). */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  const actor = await requireActor();
  if (typeof endpoint !== "string") return;
  await createAdminClient()
    .from("push_subscription")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", actor.userId as string);
}

/** Notificação de teste para os aparelhos da própria pessoa. Devolve quantos receberam. */
export async function sendTestPush(): Promise<number> {
  const actor = await requireActor();
  return sendPush([actor.userId as string], {
    title: "Notificações ativadas",
    body: "É assim que os avisos do sistema vão chegar neste aparelho.",
    url: "/avisos",
    tag: "teste",
  });
}
