"use server";

import { CardService, ForbiddenError, GateBlockedError, type RuleViolation } from "@ecco/core";
import { revalidatePath } from "next/cache";

import { provisionAndGetActor, requireActor } from "@/lib/actor";
import { createSupabaseMovePort } from "@/lib/board/cardMoveAdapter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  ActivityView,
  AttachmentView,
  ChecklistItemView,
  ChecklistView,
  CommentView,
  MemberOption,
  RoleOption,
  UserRow,
} from "@/lib/board/types";

/** Registra uma atividade no card (feed estilo Trello). */
async function recordActivity(
  cardId: string,
  actorId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return;
  await db.from("activity").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    actor_id: actorId,
    kind,
    payload,
  });
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** Cria um card na 1ª etapa só com o nome. O #number vem por trigger no banco. */
export async function createCard(title: string): Promise<void> {
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, organization_id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!board) throw new Error("Nenhum board encontrado.");

  const { data: firstStage } = await db
    .from("stage")
    .select("id")
    .eq("board_id", board.id)
    .order("position")
    .limit(1)
    .single();
  if (!firstStage) throw new Error("Board sem etapas.");

  const { error } = await db.from("card").insert({
    organization_id: board.organization_id,
    board_id: board.id,
    stage_id: firstStage.id,
    title: title.trim() || "Novo card",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Move um card de etapa PELO CardService — avalia os gates (workflow_rules) no
 * servidor. Se um gate block barrar, retorna { ok:false, reason } (não move).
 */
export async function moveCard(
  cardId: string,
  toStageId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const actor = await provisionAndGetActor();
  if (!actor) return { ok: false, reason: "Sessão expirada. Entre novamente." };

  const service = new CardService(createSupabaseMovePort(), () => new Date().toISOString());
  try {
    await service.move(actor, cardId, toStageId);
    await recordActivity(cardId, actor.userId, "card_moved", { toStageId });
    revalidatePath("/board");
    return { ok: true };
  } catch (e) {
    if (e instanceof GateBlockedError) {
      const violations = (e.details ?? []) as RuleViolation[];
      return { ok: false, reason: violations[0]?.message ?? "Transição bloqueada." };
    }
    if (e instanceof ForbiddenError) {
      return { ok: false, reason: "Você não tem permissão para mover cards." };
    }
    throw e;
  }
}

/** Renomeia o card. */
export async function updateCard(input: { id: string; title: string }): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("card")
    .update({ title: input.title.trim() || "Novo card" })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

// ── Checklists ───────────────────────────────────────────────────────────────

export async function loadChecklists(cardId: string): Promise<ChecklistView[]> {
  const db = await createClient(); // sessão → RLS escopa por usuário
  const { data: lists } = await db
    .from("checklist")
    .select("id, name, position")
    .eq("card_id", cardId)
    .order("position");
  if (!lists || lists.length === 0) return [];

  const { data: items } = await db
    .from("checklist_item")
    .select("id, checklist_id, text, done, position")
    .in(
      "checklist_id",
      lists.map((l) => l.id),
    )
    .order("position");

  const byList = new Map<string, ChecklistItemView[]>();
  for (const it of items ?? []) {
    const arr = byList.get(it.checklist_id) ?? [];
    arr.push({ id: it.id, text: it.text, done: it.done, position: Number(it.position) });
    byList.set(it.checklist_id, arr);
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    position: Number(l.position),
    items: byList.get(l.id) ?? [],
  }));
}

async function nextPosition(
  db: ReturnType<typeof createAdminClient>,
  table: "checklist" | "checklist_item",
  column: "card_id" | "checklist_id",
  value: string,
): Promise<number> {
  const { data } = await db
    .from(table)
    .select("position")
    .eq(column, value)
    .order("position", { ascending: false })
    .limit(1);
  const top = data?.[0];
  return top ? Number(top.position) + 1 : 0;
}

export async function addChecklist(cardId: string, name: string): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const position = await nextPosition(db, "checklist", "card_id", cardId);
  const { error } = await db.from("checklist").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    name: name.trim() || "Checklist",
    position,
  });
  if (error) throw new Error(error.message);
}

export async function addChecklistItem(checklistId: string, text: string): Promise<void> {
  const db = createAdminClient();
  const position = await nextPosition(db, "checklist_item", "checklist_id", checklistId);
  const { error } = await db
    .from("checklist_item")
    .insert({ checklist_id: checklistId, text: text.trim(), position });
  if (error) throw new Error(error.message);
}

export async function setChecklistItemDone(itemId: string, done: boolean): Promise<void> {
  const db = createAdminClient();
  const { data: item } = await db
    .from("checklist_item")
    .select("text, checklist_id")
    .eq("id", itemId)
    .maybeSingle();

  const { error } = await db.from("checklist_item").update({ done }).eq("id", itemId);
  if (error) throw new Error(error.message);

  // Log de atividade: quem marcou/desmarcou o quê (feed estilo Trello).
  const actor = await provisionAndGetActor();
  if (actor && item) {
    const { data: cl } = await db
      .from("checklist")
      .select("card_id")
      .eq("id", item.checklist_id)
      .maybeSingle();
    if (cl) {
      await recordActivity(
        cl.card_id,
        actor.userId,
        done ? "checklist_checked" : "checklist_unchecked",
        { text: item.text },
      );
    }
  }
}

export async function loadActivity(cardId: string): Promise<ActivityView[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("activity")
    .select("id, kind, payload, created_at, actor_id")
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = data ?? [];

  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const nameOf = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await db
      .from("app_user")
      .select("id, name, email")
      .in("id", actorIds);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: (r.payload as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
    actorName: nameOf.get(r.actor_id) ?? "Alguém",
  }));
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("checklist_item").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("checklist").delete().eq("id", checklistId);
  if (error) throw new Error(error.message);
}

// ── Anexos (qualquer link clicável) ──────────────────────────────────────────

function normalizeUrl(url: string): string {
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function loadAttachments(cardId: string): Promise<AttachmentView[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("attachment")
    .select("id, label, url")
    .eq("card_id", cardId)
    .order("created_at");
  return (data ?? []).map((a) => ({ id: a.id, label: a.label, url: a.url }));
}

export async function addAttachment(
  cardId: string,
  url: string,
  label: string,
): Promise<void> {
  const db = createAdminClient();
  if (!url.trim()) throw new Error("Informe um link.");
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const { error } = await db.from("attachment").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    kind: "link",
    url: normalizeUrl(url),
    label: label.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("attachment").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Responsável por etapa (assignment card↔user↔etapa) ───────────────────────

export async function loadMembers(): Promise<MemberOption[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db.from("app_user").select("id, name, email").order("name");
  return (data ?? []).map((u) => ({ id: u.id, name: u.name || u.email }));
}

export async function loadCardAssignments(
  cardId: string,
): Promise<{ stageId: string; userId: string }[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("assignment")
    .select("stage_id, user_id")
    .eq("card_id", cardId)
    .not("stage_id", "is", null);
  return (data ?? []).map((a) => ({ stageId: a.stage_id, userId: a.user_id }));
}

/** Define o responsável de (card, etapa). userId null = remove. Um por etapa. */
export async function setStageResponsible(
  cardId: string,
  stageId: string,
  userId: string | null,
): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");

  await db.from("assignment").delete().eq("card_id", cardId).eq("stage_id", stageId);
  if (userId) {
    const { error } = await db.from("assignment").insert({
      organization_id: card.organization_id,
      card_id: cardId,
      stage_id: stageId,
      user_id: userId,
    });
    if (error) throw new Error(error.message);
    const actor = await provisionAndGetActor();
    if (actor) await recordActivity(cardId, actor.userId, "assignment_changed", { stageId, userId });
  }
  revalidatePath("/board");
}

// ── Usuários (acessos) ───────────────────────────────────────────────────────

export async function loadRoles(): Promise<RoleOption[]> {
  const db = createAdminClient();
  const { data } = await db.from("role").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export async function loadUsers(): Promise<UserRow[]> {
  const db = createAdminClient();
  const [usersRes, ursRes, rolesRes] = await Promise.all([
    db.from("app_user").select("id, name, email, is_internal").order("name"),
    db.from("user_role").select("user_id, role_id"),
    db.from("role").select("id, name"),
  ]);
  const roleName = new Map((rolesRes.data ?? []).map((r) => [r.id, r.name]));
  const roleOfUser = new Map<string, string>();
  for (const ur of ursRes.data ?? []) roleOfUser.set(ur.user_id, ur.role_id);

  return (usersRes.data ?? []).map((u) => {
    const roleId = roleOfUser.get(u.id) ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      internal: u.is_internal,
      roleId,
      roleName: roleId ? (roleName.get(roleId) ?? null) : null,
    };
  });
}

/** Troca o papel de um usuário (um papel por usuário). */
export async function setUserRole(userId: string, roleId: string): Promise<void> {
  const db = createAdminClient();
  await db.from("user_role").delete().eq("user_id", userId);
  const { error } = await db.from("user_role").insert({ user_id: userId, role_id: roleId });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracoes/usuarios");
}

// ── Comentários ──────────────────────────────────────────────────────────────

export async function loadComments(cardId: string): Promise<CommentView[]> {
  const db = await createClient(); // sessão → RLS
  const actor = await provisionAndGetActor();
  const { data } = await db
    .from("comment")
    .select("id, body, author_id, created_at")
    .eq("card_id", cardId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
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
    isOwn: actor?.userId === r.author_id,
  }));
}

export async function addComment(cardId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const actor = await provisionAndGetActor();
  if (!actor) throw new Error("Sessão expirada. Entre novamente.");
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const { error } = await db.from("comment").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    author_id: actor.userId,
    body: text,
    mentions: [],
  });
  if (error) throw new Error(error.message);
}

// ── Configuração de etapas (colunas) — só Gestor (board:configure) ───────────

export async function addStage(name: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { data: board } = await db
    .from("board")
    .select("id, organization_id")
    .order("created_at")
    .limit(1)
    .single();
  if (!board) throw new Error("Nenhum board.");
  const { data: last } = await db
    .from("stage")
    .select("position")
    .eq("board_id", board.id)
    .order("position", { ascending: false })
    .limit(1);
  const position = last?.[0] ? Number(last[0].position) + 1 : 0;
  const { error } = await db.from("stage").insert({
    organization_id: board.organization_id,
    board_id: board.id,
    name: name.trim() || "Nova etapa",
    position,
    category: "in_progress",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function renameStage(stageId: string, name: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { error } = await db
    .from("stage")
    .update({ name: name.trim() || "Etapa" })
    .eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function setStageCategory(stageId: string, category: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { error } = await db.from("stage").update({ category }).eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function deleteStage(stageId: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { count } = await db
    .from("card")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if ((count ?? 0) > 0) {
    throw new Error("Mova os cards desta etapa antes de removê-la.");
  }
  const { error } = await db.from("stage").delete().eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/** Troca a etapa de lugar com a vizinha (reordena as colunas). */
export async function reorderStage(stageId: string, direction: "left" | "right"): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { data: st } = await db.from("stage").select("board_id").eq("id", stageId).single();
  if (!st) throw new Error("Etapa não encontrada.");
  const { data: stages } = await db
    .from("stage")
    .select("id, position")
    .eq("board_id", st.board_id)
    .order("position");
  const list = stages ?? [];
  const idx = list.findIndex((s) => s.id === stageId);
  const swap = direction === "left" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx]!;
  const b = list[swap]!;
  await db.from("stage").update({ position: b.position }).eq("id", a.id);
  await db.from("stage").update({ position: a.position }).eq("id", b.id);
  revalidatePath("/board");
}

/** Remove o comentário — só o autor pode. */
export async function deleteComment(id: string): Promise<void> {
  const actor = await provisionAndGetActor();
  if (!actor) throw new Error("Sessão expirada.");
  const db = createAdminClient();
  const { data: c } = await db.from("comment").select("author_id").eq("id", id).maybeSingle();
  if (!c || c.author_id !== actor.userId) {
    throw new Error("Só o autor pode remover o comentário.");
  }
  await db.from("comment").delete().eq("id", id);
}
