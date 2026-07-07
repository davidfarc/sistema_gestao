"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { getSessionUser } from "@/lib/auth";
import type { ChannelView, MessageView } from "@/lib/board/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Canais que o usuário pode ver (RLS: só onde é membro). */
export async function loadChannels(): Promise<ChannelView[]> {
  const db = await createClient();
  const { data } = await db
    .from("channel")
    .select("id, name")
    .is("archived_at", null)
    .order("created_at");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}

/** Cria um canal e adiciona todos os usuários internos como membros. */
export async function createChannel(name: string): Promise<void> {
  await requireActor("channel:post");
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
    .insert({ organization_id: org.id, name: name.trim() || "Canal" })
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
