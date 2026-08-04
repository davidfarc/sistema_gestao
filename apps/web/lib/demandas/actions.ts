"use server";

import { revalidatePath } from "next/cache";

import { provisionAndGetActor } from "@/lib/actor";
import { getSessionUser } from "@/lib/auth";
import { loadCardFieldValues, loadFields } from "@/lib/board/actions";
import {
  cargoCanFillSlot,
  computeDemand,
  resolveApprovals,
  slotsOf,
  type ApprovalRow,
  type DemandPanelData,
} from "@/lib/demandas/eval";
import { loadBoardThresholds } from "@/lib/demandas/thresholds";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function approvalsOf(
  db: Awaited<ReturnType<typeof createClient>>,
  cardId: string,
): Promise<{ rows: { approver_id: string; approved: boolean; note: string | null; created_at: string }[]; approvals: ApprovalRow[] }> {
  const { data } = await db
    .from("approval")
    .select("approver_id, approved, note, created_at")
    .eq("card_id", cardId)
    .order("created_at");
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.approver_id))];
  const nameOf = new Map<string, string>();
  const cargoOf = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email, cargo").in("id", ids);
    for (const u of users ?? []) {
      nameOf.set(u.id, u.name || u.email);
      cargoOf.set(u.id, u.cargo ?? null);
    }
  }
  const approvals: ApprovalRow[] = rows.map((r) => ({
    approverName: nameOf.get(r.approver_id) ?? "Alguém",
    cargo: cargoOf.get(r.approver_id) ?? null,
    approved: r.approved,
    note: r.note,
    at: r.created_at,
  }));
  return { rows, approvals };
}

/** Painel da demanda (resumo da alçada + estado das aprovações). Null se não é demanda. */
export async function loadDemandPanel(cardId: string): Promise<DemandPanelData | null> {
  const su = await getSessionUser();
  if (!su) return null;
  const db = await createClient();

  const { data: card } = await db.from("card").select("board_id").eq("id", cardId).maybeSingle();
  if (!card) return null;

  const [fields, values, thresholds] = await Promise.all([
    loadFields(card.board_id),
    loadCardFieldValues(cardId),
    loadBoardThresholds(card.board_id),
  ]);
  const computed = computeDemand(fields, values, thresholds);
  if (!computed) return null;

  const slots = slotsOf(computed.alcada.approvers);
  const { rows, approvals } = await approvalsOf(db, cardId);
  const { slotStatus, status } = resolveApprovals(slots, approvals);

  const { data: me } = await db
    .from("app_user")
    .select("cargo, is_internal")
    .eq("id", su.id)
    .maybeSingle();
  const alreadyVoted = rows.some((r) => r.approver_id === su.id);
  const canApprove =
    status === "pendente" &&
    !!me?.is_internal &&
    !alreadyVoted &&
    cargoCanFillSlot(slots, approvals, me?.cargo ?? null);

  return {
    bracket: computed.alcada.bracket,
    track: computed.alcada.track,
    slaDias: computed.alcada.slaDias,
    rice: computed.rice,
    effort: computed.effort,
    triggers: computed.alcada.triggers.map((t) => ({ kind: t.kind, message: t.message })),
    fields: computed.fields,
    slots: slotStatus,
    approvals,
    status,
    canApprove,
  };
}

/** Registra o voto (aprovar/reprovar) do usuário atual numa demanda. */
export async function submitApproval(
  cardId: string,
  approved: boolean,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await provisionAndGetActor();
  if (!actor) return { ok: false, error: "Sessão expirada." };
  if (!actor.isInternal) return { ok: false, error: "Sem permissão." };

  const db = await createClient();
  const { data: card } = await db
    .from("card")
    .select("board_id, organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "Card não encontrado." };

  const [boardFields, values, thresholds] = await Promise.all([
    loadFields(card.board_id),
    loadCardFieldValues(cardId),
    loadBoardThresholds(card.board_id),
  ]);
  // O servidor é a fonte de verdade da faixa — nunca confia no que veio do client.
  const computed = computeDemand(boardFields, values, thresholds);
  if (!computed) return { ok: false, error: "Não é uma demanda." };

  const slots = slotsOf(computed.alcada.approvers);
  const { rows, approvals } = await approvalsOf(db, cardId);
  const { status } = resolveApprovals(slots, approvals);
  if (status !== "pendente") return { ok: false, error: "Aprovação já finalizada." };
  if (rows.some((r) => r.approver_id === (actor.userId as string))) {
    return { ok: false, error: "Você já votou nesta demanda." };
  }

  const { data: me } = await db.from("app_user").select("cargo").eq("id", actor.userId as string).maybeSingle();
  const cargo = me?.cargo ?? null;
  const isApprover = slots.some((s) => cargo && s.eligible.includes(cargo));
  if (!isApprover) return { ok: false, error: "Seu cargo não participa desta aprovação." };
  if (approved && !cargoCanFillSlot(slots, approvals, cargo)) {
    return { ok: false, error: "A vaga do seu cargo já foi preenchida." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("approval").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    approver_id: actor.userId as string,
    approved,
    note: note.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  await admin.from("activity").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    actor_id: actor.userId as string,
    kind: approved ? "demand_approved" : "demand_rejected",
    payload: { note: note.trim() || null },
  });

  revalidatePath("/board");
  return { ok: true };
}
