"use server";

import { ACTIONS, type Action } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RoleDetail {
  id: string;
  name: string;
  /** Papéis de sistema têm slug e não podem ser excluídos. */
  slug: string | null;
  permissions: Action[];
  /** Quantas pessoas ativas usam este papel. */
  users: number;
}

/** Descarta o que não é ação conhecida (o jsonb aceitaria qualquer string). */
function sanear(perms: unknown): Action[] {
  const lista = Array.isArray(perms) ? perms : [];
  return ACTIONS.filter((a) => lista.includes(a));
}

function ehAdministrativo(perms: Action[]): boolean {
  return perms.includes("role:manage") || perms.includes("user:manage");
}

export async function loadRoleDetails(): Promise<RoleDetail[]> {
  const actor = await requireActor("user:manage");
  const db = createAdminClient();
  const [{ data: roles }, { data: urs }, { data: ativos }] = await Promise.all([
    db
      .from("role")
      .select("id, name, slug, permissions")
      .eq("organization_id", actor.organizationId as string)
      .order("name"),
    db.from("user_role").select("user_id, role_id"),
    db.from("app_user").select("id").is("archived_at", null),
  ]);

  const ativo = new Set((ativos ?? []).map((u) => u.id));
  const contagem = new Map<string, number>();
  for (const ur of urs ?? []) {
    if (ativo.has(ur.user_id)) contagem.set(ur.role_id, (contagem.get(ur.role_id) ?? 0) + 1);
  }

  return (roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    permissions: sanear(r.permissions),
    users: contagem.get(r.id) ?? 0,
  }));
}

/**
 * Impede que a organização fique sem quem administra. Recebe o estado que a
 * mudança produziria e recusa se ninguém ativo sobrar com a permissão.
 */
async function garantirSobrevivente(
  db: ReturnType<typeof createAdminClient>,
  acao: Action,
  roleAlterado: string,
  permsDepois: Action[] | null, // null = papel excluído
): Promise<void> {
  const { data: roles } = await db.from("role").select("id, permissions");
  const comAcao = (roles ?? [])
    .filter((r) => {
      if (r.id === roleAlterado) return permsDepois !== null && permsDepois.includes(acao);
      return sanear(r.permissions).includes(acao);
    })
    .map((r) => r.id);
  if (comAcao.length === 0) throw new Error(MENSAGEM[acao]);

  const { data: urs } = await db.from("user_role").select("user_id").in("role_id", comAcao);
  const ids = [...new Set((urs ?? []).map((u) => u.user_id))];
  if (ids.length === 0) throw new Error(MENSAGEM[acao]);

  const { count } = await db
    .from("app_user")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .is("archived_at", null);
  if ((count ?? 0) === 0) throw new Error(MENSAGEM[acao]);
}

const MENSAGEM: Partial<Record<Action, string>> = {
  "role:manage":
    "Esta mudança deixaria o sistema sem nenhum Gestor Master ativo — ninguém poderia editar papéis depois. Dê o papel a outra pessoa antes.",
  "user:manage":
    "Esta mudança deixaria o sistema sem ninguém para gerenciar usuários. Dê o papel a outra pessoa antes.",
};

/** Cria um papel. Nasce sem nenhuma permissão administrativa. */
export async function createRole(
  name: string,
  permissions: string[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireActor("role:manage");
  const nome = name.trim();
  if (!nome) return { ok: false, error: "Dê um nome ao papel." };

  const perms = sanear(permissions);
  const db = createAdminClient();
  const { data, error } = await db
    .from("role")
    .insert({
      organization_id: actor.organizationId as string,
      name: nome,
      permissions: perms,
      slug: null, // papel da gestão: pode ser excluído depois
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Falha ao criar o papel." };
  revalidatePath("/configuracoes/papeis");
  return { ok: true, id: data.id };
}

/** Renomeia e redefine as permissões de um papel. */
export async function updateRole(
  roleId: string,
  name: string,
  permissions: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("role:manage");
  const nome = name.trim();
  if (!nome) return { ok: false, error: "Dê um nome ao papel." };

  const db = createAdminClient();
  const { data: papel } = await db
    .from("role")
    .select("id, organization_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!papel || papel.organization_id !== (actor.organizationId as string)) {
    return { ok: false, error: "Papel não encontrado." };
  }

  const perms = sanear(permissions);

  try {
    // Só checa o que a mudança REMOVE — acrescentar nunca deixa ninguém órfão.
    for (const acao of ["role:manage", "user:manage"] as const) {
      if (!perms.includes(acao)) await garantirSobrevivente(db, acao, roleId, perms);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Mudança não permitida." };
  }

  // Um papel administrativo não pode ficar com usuário externo dentro.
  if (ehAdministrativo(perms)) {
    const externo = await temExterno(db, roleId);
    if (externo) {
      return {
        ok: false,
        error: `Este papel tem usuário externo (${externo}). Papéis com gestão de usuários ou de papéis são exclusivos de e-mails do domínio da organização.`,
      };
    }
  }

  const { error } = await db
    .from("role")
    .update({ name: nome, permissions: perms })
    .eq("id", roleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/configuracoes/papeis");
  revalidatePath("/configuracoes/usuarios");
  return { ok: true };
}

/** E-mail do primeiro usuário externo com este papel, ou null. */
async function temExterno(
  db: ReturnType<typeof createAdminClient>,
  roleId: string,
): Promise<string | null> {
  const { data: urs } = await db.from("user_role").select("user_id").eq("role_id", roleId);
  const ids = (urs ?? []).map((u) => u.user_id);
  if (ids.length === 0) return null;
  const { data } = await db
    .from("app_user")
    .select("email")
    .in("id", ids)
    .eq("is_internal", false)
    .limit(1)
    .maybeSingle();
  return data?.email ?? null;
}

/** Exclui um papel. Recusa papel de sistema e papel em uso. */
export async function deleteRole(
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("role:manage");
  const db = createAdminClient();

  const { data: papel } = await db
    .from("role")
    .select("id, name, slug, organization_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!papel || papel.organization_id !== (actor.organizationId as string)) {
    return { ok: false, error: "Papel não encontrado." };
  }
  if (papel.slug) {
    return {
      ok: false,
      error: `"${papel.name}" é um papel de sistema: o cadastro automático de novos usuários depende dele. Você pode renomeá-lo e ajustar as permissões, mas não excluí-lo.`,
    };
  }

  const { count } = await db
    .from("user_role")
    .select("user_id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} pessoa(s) ainda usam este papel. Mova-as para outro papel antes de excluir.`,
    };
  }

  const { error } = await db.from("role").delete().eq("id", roleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/configuracoes/papeis");
  return { ok: true };
}

