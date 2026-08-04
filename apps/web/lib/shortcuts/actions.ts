"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { byName } from "@/lib/board/queries";
import { normalizeHref, type ShortcutView } from "@/lib/shortcuts/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function loadShortcuts(): Promise<ShortcutView[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("shortcut")
    .select("id, label, description, href, icon, position")
    .order("position");
  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    href: s.href,
    icon: s.icon,
    position: Number(s.position),
  }));
}

export async function createShortcut(input: {
  label: string;
  description?: string;
  href: string;
  icon?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  const label = input.label.trim();
  const href = normalizeHref(input.href);
  if (!label) return { ok: false, error: "Dê um nome ao atalho." };
  if (!href) return { ok: false, error: "Informe o destino (link ou caminho)." };

  const db = createAdminClient();
  const { data: last } = await db
    .from("shortcut")
    .select("position")
    .eq("organization_id", actor.organizationId as string)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("shortcut").insert({
    organization_id: actor.organizationId as string,
    label,
    description: input.description?.trim() || null,
    href,
    icon: input.icon || null,
    position: last ? Number(last.position) + 1 : 0,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function updateShortcut(
  id: string,
  input: { label: string; description?: string; href: string; icon?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActor("board:configure");
  const label = input.label.trim();
  const href = normalizeHref(input.href);
  if (!label) return { ok: false, error: "Dê um nome ao atalho." };
  if (!href) return { ok: false, error: "Informe o destino (link ou caminho)." };

  const db = createAdminClient();
  const { error } = await db
    .from("shortcut")
    .update({
      label,
      description: input.description?.trim() || null,
      href,
      icon: input.icon || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function deleteShortcut(id: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  await db.from("shortcut").delete().eq("id", id);
  revalidatePath("/");
}

/** Move um atalho uma casa; regrava a sequência (normaliza posições). */
export async function moveShortcut(id: string, dir: "up" | "down"): Promise<void> {
  const actor = await requireActor("board:configure");
  const db = createAdminClient();
  const { data } = await db
    .from("shortcut")
    .select("id")
    .eq("organization_id", actor.organizationId as string)
    .order("position");
  const list = data ?? [];

  const i = list.findIndex((s) => s.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];

  await Promise.all(
    list.map((s, idx) => db.from("shortcut").update({ position: idx }).eq("id", s.id)),
  );
  revalidatePath("/");
}

/** Pipelines visíveis, para oferecer como destino do atalho. */
export async function loadBoardOptions(): Promise<{ id: string; name: string }[]> {
  const db = await createClient();
  const { data } = await db.from("board").select("id, name").is("archived_at", null);
  return (data ?? []).map((b) => ({ id: b.id, name: b.name })).sort(byName);
}
