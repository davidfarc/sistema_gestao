"use server";

import { getSessionUser } from "@/lib/auth";
import type { NotificationView } from "@/lib/board/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Monta título/subtítulo a partir do kind + payload (render sem query extra). */
function render(kind: string, payload: Record<string, unknown>): { title: string; subtitle: string } {
  const actor = (payload.actorName as string) || "Alguém";
  const num = payload.cardNumber != null ? `#${payload.cardNumber}` : "";
  const card = payload.cardTitle ? `«${payload.cardTitle}»` : "";
  const boardName = (payload.boardName as string) || "";
  if (kind === "mention") {
    return {
      title: `${actor} mencionou você`,
      subtitle: [`${num} ${card}`.trim(), boardName].filter(Boolean).join(" · "),
    };
  }
  if (kind === "assignment") {
    const stage = (payload.stageName as string) || "";
    return {
      title: `${actor} atribuiu você`,
      subtitle: [stage && `Etapa ${stage}`, num].filter(Boolean).join(" · "),
    };
  }
  return { title: actor, subtitle: `${num} ${card}`.trim() };
}

/** Notificações recentes do usuário atual (sessão → RLS: só as próprias). */
export async function loadNotifications(): Promise<NotificationView[]> {
  const db = await createClient();
  const { data } = await db
    .from("notification")
    .select("id, kind, payload, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []).map((n) => {
    const { title, subtitle } = render(n.kind, (n.payload as Record<string, unknown>) ?? {});
    return {
      id: n.id,
      kind: n.kind,
      title,
      subtitle,
      createdAt: n.created_at,
      read: n.read_at != null,
    };
  });
}

/** Quantas notificações não lidas (badge do sino). */
export async function notificationUnreadCount(): Promise<number> {
  const db = await createClient();
  const { count } = await db
    .from("notification")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/** Marca todas as não lidas do usuário como lidas (ao abrir o sino). */
export async function markAllNotificationsRead(): Promise<void> {
  const su = await getSessionUser();
  if (!su) return;
  const db = createAdminClient();
  await db
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", su.id)
    .is("read_at", null);
}
