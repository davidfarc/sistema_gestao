import "server-only";

import { buildPushRequest, type VapidKeys } from "@ecco/core";

import { createAdminClient } from "@/lib/supabase/admin";

/** O que o service worker (public/sw.js) recebe e mostra. */
export interface PushMessage {
  title: string;
  body: string;
  /** Para onde ir ao tocar na notificação (caminho dentro do sistema). */
  url: string;
  /** Notificações com a mesma `tag` se substituem em vez de empilhar. */
  tag?: string;
}

/**
 * Serviços de push conhecidos. A inscrição vem do navegador da pessoa, então o
 * endereço é checado antes de o servidor fazer uma requisição para ele.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

/** Chaves do remetente (segredos do Worker). `null` = push desligado. */
export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || process.env.APP_URL || "https://gestao.eccoprime.com.br",
  };
}

/**
 * Envia uma notificação push a todos os aparelhos das pessoas indicadas.
 *
 * NUNCA lança: push é um aviso a mais, não pode derrubar a ação que o gerou
 * (comentar, atribuir, enviar mensagem). Sem chaves configuradas, não faz nada.
 * Inscrição que o serviço diz não existir mais (404/410) é apagada.
 */
export async function sendPush(userIds: string[], message: PushMessage): Promise<number> {
  try {
    const vapid = vapidKeys();
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!vapid || ids.length === 0) return 0;

    const db = createAdminClient();
    const { data: subs } = await db
      .from("push_subscription")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (!subs || subs.length === 0) return 0;

    const results = await Promise.all(
      subs.map(async (sub) => {
        try {
          if (!isAllowedPushEndpoint(sub.endpoint)) return { id: sub.id, gone: true, ok: false };
          const req = await buildPushRequest(sub, message, vapid, { urgency: "high" });
          const res = await fetch(req.endpoint, {
            method: "POST",
            headers: req.headers,
            body: req.body,
            signal: AbortSignal.timeout(4000),
          });
          return { id: sub.id, gone: res.status === 404 || res.status === 410, ok: res.ok };
        } catch {
          return { id: sub.id, gone: false, ok: false };
        }
      }),
    );

    const gone = results.filter((r) => r.gone).map((r) => r.id);
    const ok = results.filter((r) => r.ok).map((r) => r.id);
    await Promise.all([
      gone.length > 0 ? db.from("push_subscription").delete().in("id", gone) : null,
      ok.length > 0
        ? db.from("push_subscription").update({ last_success_at: new Date().toISOString() }).in("id", ok)
        : null,
    ]);
    return ok.length;
  } catch (e) {
    console.error("sendPush:", e instanceof Error ? e.message : e);
    return 0;
  }
}
