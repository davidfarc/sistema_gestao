"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TokenView {
  id: string;
  name: string;
  /** Começo do token, só para a pessoa reconhecer qual é qual. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const MAX_ACTIVE_TOKENS = 5;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens da pessoa logada (nunca o valor: ele só existe na hora da criação). */
export async function listTokens(): Promise<TokenView[]> {
  const actor = await requireActor("report:read");
  const { data } = await createAdminClient()
    .from("api_token")
    .select("id, name, token_prefix, created_at, last_used_at, expires_at, revoked_at")
    .eq("user_id", actor.userId as string)
    .order("created_at", { ascending: false });
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.token_prefix,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
    expiresAt: t.expires_at,
    revokedAt: t.revoked_at,
  }));
}

/**
 * Cria um token pessoal. O valor volta UMA vez, nesta resposta; no banco fica
 * só o hash, então nem a gestão nem o suporte conseguem recuperá-lo depois.
 */
export async function createToken(
  name: string,
  validDays: number | null,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const actor = await requireActor("report:read");
  const label = (name ?? "").trim().slice(0, 60);
  if (!label) return { ok: false, error: "Dê um nome ao token (ex.: “Claude no notebook”)." };
  const days = validDays == null ? null : Math.min(Math.max(Math.round(validDays), 1), 366);

  const db = createAdminClient();
  const { count } = await db
    .from("api_token")
    .select("id", { count: "exact", head: true })
    .eq("user_id", actor.userId as string)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
    return { ok: false, error: `Você já tem ${MAX_ACTIVE_TOKENS} tokens ativos. Revogue um antes de criar outro.` };
  }

  const random = crypto.getRandomValues(new Uint8Array(32));
  const token =
    "ecco_" +
    btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const { error } = await db.from("api_token").insert({
    organization_id: actor.organizationId as string,
    user_id: actor.userId as string,
    name: label,
    token_hash: await sha256Hex(token),
    token_prefix: token.slice(0, 10),
    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
  });
  if (error) return { ok: false, error: "Não foi possível criar o token. Tente de novo." };
  return { ok: true, token };
}

/** Revoga um token da própria pessoa. Vale na consulta seguinte. */
export async function revokeToken(id: string): Promise<void> {
  const actor = await requireActor("report:read");
  await createAdminClient()
    .from("api_token")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", actor.userId as string)
    .is("revoked_at", null);
}
