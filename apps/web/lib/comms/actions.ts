"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { getSessionUser } from "@/lib/auth";
import type {
  ConversationView,
  MessageView,
  UserSearchResult,
} from "@/lib/board/types";
import { ensureDmChannel } from "@/lib/comms/dm";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function initialsOf(text: string): string {
  const t = text.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

/**
 * Lista de conversas (canais de grupo + DMs) do usuário, estilo WhatsApp:
 * última mensagem + horário + não-lidas, ordenada por atividade recente.
 */
export async function loadConversations(): Promise<ConversationView[]> {
  const su = await getSessionUser();
  if (!su) return [];
  const db = createAdminClient();
  const { data, error } = await db.rpc("conversation_list", { p_user: su.id });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r: {
    channel_id: string;
    kind: "group" | "dm";
    name: string;
    other_name: string | null;
    other_email: string | null;
    last_body: string | null;
    last_at: string | null;
    unread: number;
  }) => {
    const displayName =
      r.kind === "dm" ? r.other_name || r.other_email || "Conversa" : r.name;
    return {
      id: r.channel_id,
      kind: r.kind,
      name: displayName,
      initials: initialsOf(displayName),
      lastMessage: r.last_body,
      lastMessageAt: r.last_at,
      unread: Number(r.unread ?? 0),
    };
  });
}

/** Soma de não-lidas em todas as conversas (badge da sidebar). */
export async function loadUnreadTotal(): Promise<number> {
  const convos = await loadConversations();
  return convos.reduce((sum, c) => sum + c.unread, 0);
}

/** Cria um canal de grupo e adiciona todos os usuários internos como membros. */
export async function createChannel(name: string): Promise<void> {
  await requireActor("channel:manage");
  const db = createAdminClient();
  const { data: org } = await db
    .from("organization")
    .select("id")
    .order("created_at")
    .limit(1)
    .single();
  if (!org) throw new Error("Nenhuma organização.");

  const { data: channel, error } = await db
    .from("channel")
    .insert({ organization_id: org.id, name: name.trim() || "Canal", kind: "group" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: users } = await db
    .from("app_user")
    .select("id")
    .eq("organization_id", org.id)
    .eq("is_internal", true);
  const members = (users ?? []).map((u) => ({ channel_id: channel.id, user_id: u.id }));
  if (members.length > 0) await db.from("channel_member").insert(members);

  revalidatePath("/canais");
}

/** Busca usuários internos (exceto eu) para iniciar uma conversa. */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const actor = await requireActor("channel:post");
  const db = createAdminClient();
  let q = db
    .from("app_user")
    .select("id, name, email")
    .eq("organization_id", actor.organizationId)
    .eq("is_internal", true)
    .is("archived_at", null)
    .neq("id", actor.userId)
    .order("name")
    .limit(20);
  const term = query.trim();
  if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => ({ id: u.id, name: u.name || u.email, email: u.email }));
}

/** Abre (ou cria) a DM 1:1 com outra pessoa. Retorna o id do canal. */
export async function openOrCreateDm(otherUserId: string): Promise<string> {
  const actor = await requireActor("channel:post");
  const db = createAdminClient();
  const channelId = await ensureDmChannel(
    db,
    actor.organizationId as string,
    actor.userId as string,
    otherUserId,
  );
  revalidatePath("/canais");
  return channelId;
}

export async function loadMessages(channelId: string): Promise<MessageView[]> {
  const db = await createClient();
  const su = await getSessionUser();
  const { data } = await db
    .from("message")
    .select("id, body, author_id, created_at")
    .eq("channel_id", channelId)
    .is("archived_at", null)
    .order("created_at");
  const rows = data ?? [];

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const nameOf = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email").in("id", authorIds);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: nameOf.get(r.author_id) ?? "Alguém",
    createdAt: r.created_at,
    isOwn: su?.id === r.author_id,
  }));
}

export async function postMessage(channelId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const actor = await requireActor("channel:post");
  const db = createAdminClient();
  const { data: ch } = await db
    .from("channel")
    .select("organization_id")
    .eq("id", channelId)
    .single();
  if (!ch) throw new Error("Canal não encontrado.");
  const { error } = await db.from("message").insert({
    organization_id: ch.organization_id,
    channel_id: channelId,
    author_id: actor.userId,
    body: text,
    mentions: [],
  });
  if (error) throw new Error(error.message);
}

/** Marca a conversa como lida (last_read_at = agora) para o usuário atual. */
export async function markRead(channelId: string): Promise<void> {
  const su = await getSessionUser();
  if (!su) return;
  const db = createAdminClient();
  await db
    .from("channel_member")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", su.id);
}
