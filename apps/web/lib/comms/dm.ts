import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/** Chave estável do par (menor:maior) → 1 DM por par, permite find-or-create. */
export function dmKeyOf(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${x}:${y}`;
}

/**
 * Acha ou cria a DM 1:1 entre dois usuários e garante os dois como membros.
 * Retorna o id do canal. Usa admin client (bypassa RLS) — o chamador é quem
 * autoriza. O nome do canal é só um fallback: a lista resolve o nome pela outra
 * pessoa (RPC conversation_list).
 */
export async function ensureDmChannel(
  db: Db,
  organizationId: string,
  meId: string,
  otherId: string,
): Promise<string> {
  const dmKey = dmKeyOf(meId, otherId);

  const { data: existing } = await db
    .from("channel")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("dm_key", dmKey)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: other } = await db
    .from("app_user")
    .select("name, email")
    .eq("id", otherId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!other) throw new Error("Usuário não encontrado.");

  const { data: channel, error } = await db
    .from("channel")
    .insert({
      organization_id: organizationId,
      name: other.name || other.email,
      kind: "dm",
      dm_key: dmKey,
    })
    .select("id")
    .single();
  if (error) {
    // Corrida: outro request criou a mesma DM entre o SELECT e o INSERT.
    const { data: raced } = await db
      .from("channel")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("dm_key", dmKey)
      .maybeSingle();
    if (raced) return raced.id;
    throw new Error(error.message);
  }

  await db.from("channel_member").insert([
    { channel_id: channel.id, user_id: meId },
    { channel_id: channel.id, user_id: otherId },
  ]);
  return channel.id;
}
