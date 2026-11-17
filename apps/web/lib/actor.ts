import { cache } from "react";

import {
  asId,
  assertCan,
  ForbiddenError,
  UnauthorizedError,
  type Action,
  type Actor,
} from "@ecco/core";

import { getSessionUser, isInternalEmail } from "@/lib/auth";
import { CARGOS } from "@/lib/demandas/cargos";
import { createAdminClient } from "@/lib/supabase/admin";

/** "Diretor Geral" — vem da lista de cargos, não como string solta. */
const DIRETOR_GERAL: string = CARGOS[0];

type Db = ReturnType<typeof createAdminClient>;

/** Acesso pontual (tabela `user_grant`) → permissão que ele concede. */
const GRANT_ACTION: Record<string, Action> = {
  salas: "salas:manage",
  novos: "novos:access",
};

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

/** Permissões a partir de `user_role` com o papel embutido (`role(permissions)`). */
function permissionsFrom(rows: unknown[] | null): Set<Action> {
  const perms = new Set<Action>();
  for (const row of rows ?? []) {
    const role = (row as { role: { permissions: string[] | null } | { permissions: string[] | null }[] | null }).role;
    for (const r of Array.isArray(role) ? role : role ? [role] : []) {
      for (const p of r.permissions ?? []) perms.add(p as Action);
    }
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

  // Uma rodada só: organização, cadastro e papéis (com as permissões) em
  // paralelo. Antes eram ~6 consultas em sequência a cada clique.
  const [{ data: org }, { data: existing }, { data: roleRows }, { data: grantRows }] = await Promise.all([
    db.from("organization").select("id").order("created_at").limit(1).maybeSingle(),
    // Quem já existe aqui foi convidado (pré-cadastrado pela gestão) ou já
    // entrou antes. Busca por id e, se não achar, por e-mail: o pré-cadastro
    // cria o usuário em `auth.users`, mas o vínculo só se confirma no 1º login.
    db
      .from("app_user")
      .select("id, organization_id, email, name, cargo, archived_at, is_internal")
      .or(`id.eq.${su.id},email.eq.${su.email}`)
      .limit(1)
      .maybeSingle(),
    db.from("user_role").select("role(permissions)").eq("user_id", su.id),
    // Acessos pontuais (migration 0046). Antes dela a consulta dá erro e a
    // lista vem vazia: ninguém ganha nem perde nada por isso.
    db.from("user_grant").select("key").eq("user_id", su.id),
  ]);
  if (!org) return null;

  const internal = isInternalEmail(su.email);
  const meta = su.user_metadata ?? {};
  const name =
    (meta.full_name as string) || (meta.name as string) || su.email.split("@")[0] || su.email;

  // Porta de entrada: domínio autorizado OU convite. Sem isso, abrir a tela de
  // consentimento do Google para fora da organização deixaria qualquer conta
  // Google do mundo virar usuário desta base só por descobrir a URL.
  if (!internal && !existing) return null;

  // Acesso revogado continua revogado — arquivar precisa valer no login, senão
  // a pessoa desligada volta a entrar sozinha no próximo acesso.
  if (existing?.archived_at) return null;

  // O login NÃO rebaixa quem já existe. `is_internal` é o que a RLS consulta
  // (public.is_internal), então recalculá-lo a cada acesso deixa um erro de
  // INTERNAL_EMAIL_DOMAIN — em qualquer máquina, inclusive um dev local — apagar
  // o acesso de gente real na base compartilhada. Aconteceu em 27/08: um .env.local
  // com um domínio só marcou o Gestor Master como externo em produção.
  // Só quem entra pela primeira vez tem o valor decidido pelo domínio; mudar
  // depois é ato explícito, pela tela de usuários.
  const efetivoInterno = existing ? (existing.is_internal ?? internal) : internal;

  // Grava só quando há algo a gravar (1º acesso, vínculo do pré-cadastro, nome
  // ou e-mail mudado no Google). Antes o upsert rodava em todo clique.
  let cargo = existing?.cargo ?? null;
  const precisaGravar =
    !existing ||
    existing.id !== su.id ||
    existing.organization_id !== org.id ||
    existing.email !== su.email ||
    existing.name !== name ||
    existing.is_internal !== efetivoInterno;
  if (precisaGravar) {
    // O upsert não escreve `cargo`; o select devolve o valor atual sem query extra.
    const { data: upserted } = await db
      .from("app_user")
      .upsert(
        { id: su.id, organization_id: org.id, email: su.email, name, is_internal: efetivoInterno },
        { onConflict: "id" },
      )
      .select("cargo")
      .maybeSingle();
    cargo = upserted?.cargo ?? cargo;
  }

  let permissions = permissionsFrom(roleRows);
  if (!roleRows || roleRows.length === 0) {
    // Sem papel ainda (1º acesso): atribui o padrão e relê.
    await ensureDefaultRole(db, su.id, org.id, efetivoInterno);
    permissions = await resolvePermissions(db, su.id);
  }

  // Acesso pontual concedido por um Gestor = a permissão correspondente.
  for (const g of grantRows ?? []) {
    const action = GRANT_ACTION[g.key as string];
    if (action) permissions.add(action);
  }

  return {
    userId: asId(su.id),
    organizationId: asId(org.id),
    isInternal: efetivoInterno,
    permissions,
    teamIds: [],
    cargo,
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

/**
 * Quem pode mexer nos limites de alçada: o **Diretor Geral** (decisão de
 * governança financeira) ou o **Gestor** — que é o usuário master e pode
 * delegar. `user:manage` é o proxy de "é Gestor" (ação exclusiva desse papel).
 * Não lança — use para esconder/mostrar UI.
 */
export function canManageAlcadas(actor: Actor | null | undefined): boolean {
  if (!actor) return false;
  return actor.cargo === DIRETOR_GERAL || actor.permissions.has("user:manage");
}

/** Versão que lança — use nas escritas do servidor. */
export async function requireAlcadaManager(): Promise<Actor> {
  const actor = await provisionAndGetActor();
  if (!actor) throw new UnauthorizedError("Autenticação necessária.");
  if (!canManageAlcadas(actor)) {
    throw new ForbiddenError("Só a Direção Geral ou um Gestor pode alterar os limites de alçada.");
  }
  return actor;
}
