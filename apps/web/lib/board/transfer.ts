"use server";

import { revalidatePath } from "next/cache";

import type { Actor } from "@ecco/core";

import { requireActor } from "@/lib/actor";
import { loadCardFieldValues, loadFields, loadMembers } from "@/lib/board/actions";
import { resolveChip } from "@/lib/board/chips";
import { assertCanCreateInBoard } from "@/lib/board/intake";
import { byName } from "@/lib/board/queries";
import type { FieldType } from "@/lib/board/types";
import { sendPush } from "@/lib/push/send";
import { stopTimersOnCard } from "@/lib/time/stop";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Enviar um card para OUTRO pipeline (SPEC-FASE2 §E.4).
 *
 * Não é uma movimentação de etapa, então não passa pelo CardService.move: o
 * card sai de um fluxo e entra na primeira etapa de outro, onde a gestão de lá
 * define o novo responsável. A troca em si é a função `transfer_card` do banco
 * (migration 0040), numa transação. Aqui ficam as checagens de permissão.
 */

export interface TransferTarget {
  id: string;
  name: string;
}

export interface TransferField {
  id: string;
  name: string;
  type: FieldType;
}

export interface TransferPlan {
  targetName: string;
  /** Campos do pipeline de origem que têm valor neste card. */
  source: (TransferField & { display: string; suggestedTo: string | null })[];
  /** Campos próprios do pipeline de destino. */
  target: TransferField[];
}

/** Tipos que podem receber o valor um do outro. */
function compatible(a: FieldType, b: FieldType): boolean {
  if (a === b) return true;
  const text: FieldType[] = ["text", "long_text"];
  const choice: FieldType[] = ["select", "status"];
  return (text.includes(a) && text.includes(b)) || (choice.includes(a) && choice.includes(b));
}

/**
 * Pode enviar para este pipeline? Com `card:transfer`, qualquer pipeline da
 * organização; sem ela, vale a regra de "quem pode abrir demanda" no destino.
 */
async function assertCanSendTo(actor: Actor, targetBoardId: string): Promise<void> {
  if (actor.permissions.has("card:transfer")) {
    const { data: board } = await createAdminClient()
      .from("board")
      .select("organization_id, archived_at")
      .eq("id", targetBoardId)
      .maybeSingle();
    if (board && board.organization_id === (actor.organizationId as string) && !board.archived_at) return;
    throw new Error("Pipeline não encontrado.");
  }
  await assertCanCreateInBoard(targetBoardId);
}

/** O card, se a pessoa logada o enxerga (RLS) e pode mover cards. */
async function cardForTransfer(cardId: string) {
  const actor = await requireActor("card:move");
  const db = await createClient(); // sessão → RLS decide se ela vê o card
  const { data: card } = await db
    .from("card")
    .select("id, board_id, number, title, organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) throw new Error("Card não encontrado.");
  return { actor, card };
}

/**
 * Pipelines para onde a pessoa pode enviar: os que ela enxerga e os que têm a
 * caixa de entrada aberta para ela — a mesma regra de "quem pode abrir demanda".
 */
export async function loadTransferTargets(cardId: string): Promise<TransferTarget[]> {
  const { actor, card } = await cardForTransfer(cardId);
  if (!actor.permissions.has("card:create") && !actor.permissions.has("card:transfer")) return [];
  const db = createAdminClient();
  const [{ data: boards }, { data: memberships }] = await Promise.all([
    db
      .from("board")
      .select("id, name, intake, intake_user_ids")
      .eq("organization_id", actor.organizationId as string)
      .is("archived_at", null)
      .neq("id", card.board_id),
    db.from("board_member").select("board_id").eq("user_id", actor.userId as string),
  ]);
  const seesAll = actor.permissions.has("board:configure") || actor.permissions.has("card:transfer");
  const memberOf = new Set((memberships ?? []).map((m) => m.board_id));
  return (boards ?? [])
    .filter((b) => {
      if (seesAll || memberOf.has(b.id)) return true;
      if (!actor.isInternal) return false;
      if (b.intake === "org") return true;
      return (
        b.intake === "users" &&
        ((b.intake_user_ids as string[] | null) ?? []).includes(actor.userId as string)
      );
    })
    .map((b) => ({ id: b.id, name: b.name }))
    .sort(byName);
}

/** O que será conciliado: campos de origem com valor e os campos do destino. */
export async function loadTransferPlan(cardId: string, targetBoardId: string): Promise<TransferPlan> {
  const { actor, card } = await cardForTransfer(cardId);
  await assertCanSendTo(actor, targetBoardId);
  const db = createAdminClient();

  const [sourceFields, values, members, targetBoard, targetFieldsRes] = await Promise.all([
    loadFields(card.board_id),
    loadCardFieldValues(cardId),
    loadMembers(),
    db.from("board").select("name").eq("id", targetBoardId).maybeSingle(),
    // Só o esqueleto dos campos do destino (a pessoa pode não enxergar o quadro).
    db
      .from("field_definition")
      .select("id, name, type, position")
      .eq("board_id", targetBoardId)
      .is("archived_at", null)
      .order("position"),
  ]);

  const target: TransferField[] = (targetFieldsRes.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type as FieldType,
  }));
  const valueOf = new Map(values.map((v) => [v.fieldId, v]));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
  const taken = new Set<string>();

  const source: TransferPlan["source"] = [];
  for (const f of sourceFields) {
    if (f.global) continue; // campos globais acompanham o card sozinhos
    const chip = resolveChip(f, valueOf.get(f.id), nameOf);
    if (!chip) continue;
    // Sugestão: campo de mesmo nome e tipo compatível, ainda não usado.
    const match = target.find(
      (t) =>
        !taken.has(t.id) &&
        compatible(f.type, t.type) &&
        t.name.trim().toLowerCase() === f.name.trim().toLowerCase(),
    );
    if (match) taken.add(match.id);
    source.push({
      id: f.id,
      name: f.name,
      type: f.type,
      display: f.type === "checkbox" ? "sim" : chip.display,
      suggestedTo: match?.id ?? null,
    });
  }
  return { targetName: targetBoard.data?.name ?? "", source, target };
}

const ERRORS: Record<string, string> = {
  card_not_found: "Card não encontrado.",
  same_board: "O card já está neste pipeline.",
  target_not_found: "Pipeline de destino não encontrado.",
  target_without_stages: "O pipeline de destino ainda não tem etapas.",
};

/** Envia o card. `map` liga cada campo de origem a um do destino (ou a nenhum). */
export async function transferCard(
  cardId: string,
  targetBoardId: string,
  map: { from: string; to: string | null }[],
): Promise<
  | { ok: true; boardId: string; boardName: string; number: number; fieldsKept: boolean }
  | { ok: false; error: string }
> {
  const { actor, card } = await cardForTransfer(cardId);
  try {
    await assertCanSendTo(actor, targetBoardId);
  } catch {
    return { ok: false, error: "Você não pode enviar cards para este pipeline." };
  }
  const clean = (Array.isArray(map) ? map : [])
    .filter((m) => m && typeof m.from === "string")
    .slice(0, 200)
    .map((m) => ({ from: m.from, to: typeof m.to === "string" ? m.to : "" }));

  const db = createAdminClient();
  const { data, error } = await db.rpc("transfer_card", {
    p_card: cardId,
    p_target_board: targetBoardId,
    p_actor: actor.userId as string,
    p_map: clean,
  });
  if (error || !data) {
    const code = Object.keys(ERRORS).find((k) => error?.message?.includes(k));
    return { ok: false, error: code ? ERRORS[code]! : "Não foi possível enviar o card. Tente de novo." };
  }
  const result = data as { boardId: string; boardName: string; number: number; fieldsKept: boolean };
  await stopTimersOnCard(cardId);

  // Avisa quem pode definir o novo responsável no destino: membros do pipeline
  // com permissão de atribuir. O card chegou sem dono.
  try {
    const [{ data: members }, { data: me }] = await Promise.all([
      db.from("board_member").select("user_id").eq("board_id", targetBoardId),
      db.from("app_user").select("name, email").eq("id", actor.userId as string).maybeSingle(),
    ]);
    const ids = (members ?? []).map((m) => m.user_id).filter((id) => id !== (actor.userId as string));
    if (ids.length > 0) {
      const { data: roles } = await db
        .from("user_role")
        .select("user_id, role:role_id(permissions)")
        .in("user_id", ids);
      const assigners = [
        ...new Set(
          (roles ?? [])
            .filter((r) => {
              const role = (Array.isArray(r.role) ? r.role[0] : r.role) as { permissions?: unknown } | null;
              return Array.isArray(role?.permissions) && role.permissions.includes("card:assign");
            })
            .map((r) => r.user_id as string),
        ),
      ];
      if (assigners.length > 0) {
        const actorName = me?.name || me?.email || "Alguém";
        await db.from("notification").insert(
          assigners.map((uid) => ({
            organization_id: card.organization_id,
            user_id: uid,
            kind: "transfer",
            payload: {
              actorName,
              cardNumber: result.number,
              cardTitle: card.title,
              boardName: result.boardName,
            },
          })),
        );
        await sendPush(assigners, {
          title: `Card novo em ${result.boardName}`,
          body: `${actorName} enviou #${result.number} ${card.title}. Falta definir o responsável.`,
          url: `/board?card=${cardId}`,
          tag: `card-${cardId}`,
        });
      }
    }
  } catch (e) {
    // O card já foi enviado; falha no aviso não desfaz nem derruba a ação.
    console.error("transferCard/aviso:", e instanceof Error ? e.message : e);
  }

  revalidatePath("/board");
  return { ok: true, ...result };
}
