import { cache } from "react";

import { asId, assertCan, UnauthorizedError, type Action, type Actor } from "@ecco/core";

import { getSessionUser, isInternalEmail } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

async function resolvePermissions(db: Db, userId: string): Promise<Set<Action>> {
  const { data: userRoles } = await db.from("user_role").select("role_id").eq("user_id", userId);
  const roleIds = (userRoles ?? []).map((r) => r.role_id);
  if (roleIds.length === 0) return new Set();
  const { data: roles } = await db.from("role").select("permissions").in("id", roleIds);
  const perms = new Set<Action>();
  for (const r of roles ?? []) {
    for (const p of (r.permissions as string[] | null) ?? []) perms.add(p as Action);
  }
  return perms;
}

async function ensureDefaultRole(db: Db, userId: string, orgId: string, internal: boolean) {
  const { count } = await db
    .from("user_role")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return;

  let roleName: string;
  if (!internal) {
    roleName = "Externo";
  } else {
    // Bootstrap: o primeiro interno (enquanto não houver nenhum Gestor) vira Gestor.
    const { data: gestor } = await db
      .from("role")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", "Gestor")
      .maybeSingle();
    let hasGestor = false;
    if (gestor) {
      const { count: gc } = await db
        .from("user_role")
        .select("user_id", { count: "exact", head: true })
        .eq("role_id", gestor.id);
      hasGestor = (gc ?? 0) > 0;
    }
    roleName = hasGestor ? "Membro interno" : "Gestor";
  }

  const { data: role } = await db
    .from("role")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", roleName)
    .maybeSingle();
  if (role) await db.from("user_role").insert({ user_id: userId, role_id: role.id });
}

/**
 * Garante o `app_user` do usuário logado (provisionamento no login) e devolve o
 * Actor do core (com permissões resolvidas dos papéis). Null se não autenticado.
 * Idempotente — pode ser chamado a cada request.
 */
export const provisionAndGetActor = cache(async (): Promise<Actor | null> => {
  const su = await getSessionUser();
  if (!su?.email) return null;

  const db = createAdminClient();
  const { data: org } = await db
    .from("organization")
    .select("id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!org) return null;

  const internal = isInternalEmail(su.email);
  const meta = su.user_metadata ?? {};
  const name =
    (meta.full_name as string) || (meta.name as string) || su.email.split("@")[0] || su.email;

  await db.from("app_user").upsert(
    { id: su.id, organization_id: org.id, email: su.email, name, is_internal: internal },
    { onConflict: "id" },
  );
  await ensureDefaultRole(db, su.id, org.id, internal);

  const permissions = await resolvePermissions(db, su.id);
  return {
    userId: asId(su.id),
    organizationId: asId(org.id),
    isInternal: internal,
    permissions,
    teamIds: [],
  };
});

/**
 * Garante um ator autenticado e (opcional) uma permissão — lança
 * UnauthorizedError/ForbiddenError se faltar. Use nas escritas do servidor.
 */
export async function requireActor(action?: Action): Promise<Actor> {
  const actor = await provisionAndGetActor();
  if (!actor) throw new UnauthorizedError("Autenticação necessária.");
  if (action) assertCan(actor, action);
  return actor;
}
