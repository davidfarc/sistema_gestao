"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { loadFields } from "@/lib/board/actions";
import { DF } from "@/lib/demandas/fields";
import type { PlanGrid } from "@/lib/planejamento/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Dimensão do planejamento gravada hoje. 'tipo' já é aceito pelo banco (0032). */
const KIND = "area";

/**
 * Grade de planejamento de um ano: linhas = opções do campo "Área beneficiada",
 * colunas = os 12 meses. As linhas saem do campo, então dividir "Pedagógico" em
 * segmentos faz a grade crescer sozinha.
 */
export async function loadPlanGrid(boardId: string, year: number): Promise<PlanGrid | null> {
  const db = await createClient(); // sessão → RLS

  const { data: board } = await db
    .from("board")
    .select("id, name, creation_form")
    .eq("id", boardId)
    .is("archived_at", null)
    .maybeSingle();
  if (!board || board.creation_form !== "custom:demandas") return null;

  const fields = await loadFields(boardId);
  const area = fields.find((f) => f.name === DF.area);
  const categories = (area?.options ?? []).map((o) => ({ id: o.id, label: o.label }));

  const { data: rows } = await db
    .from("spend_plan")
    .select("category_id, month, amount")
    .eq("board_id", boardId)
    .eq("year", year)
    .eq("category_kind", KIND);

  const amounts: Record<string, Record<number, number>> = {};
  for (const r of rows ?? []) {
    const byMonth = (amounts[r.category_id] ??= {});
    byMonth[Number(r.month)] = Number(r.amount);
  }

  return { boardId: board.id, boardName: board.name, year, categories, amounts };
}

/** Grava uma célula da grade. Zero apaga a linha em vez de guardar lixo. */
export async function savePlanCell(input: {
  boardId: string;
  year: number;
  month: number;
  categoryId: string;
  amount: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("plan:manage");
  const { boardId, year, month, categoryId } = input;
  if (month < 1 || month > 12) return { ok: false, error: "Mês inválido." };
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "Valor inválido." };
  }

  const db = createAdminClient();
  const { data: board } = await db
    .from("board")
    .select("organization_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return { ok: false, error: "Pipeline não encontrado." };

  const amount = Math.round(input.amount * 100) / 100;

  if (amount === 0) {
    const { error } = await db
      .from("spend_plan")
      .delete()
      .eq("board_id", boardId)
      .eq("year", year)
      .eq("month", month)
      .eq("category_kind", KIND)
      .eq("category_id", categoryId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("spend_plan").upsert(
      {
        organization_id: board.organization_id,
        board_id: boardId,
        year,
        month,
        category_kind: KIND,
        category_id: categoryId,
        amount,
        updated_by: actor.userId as string,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "board_id,year,month,category_kind,category_id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/prioridades");
  return { ok: true };
}

/**
 * Repete o valor de um mês nos meses seguintes do ano — o orçamento costuma ser
 * parecido mês a mês, e a grade tem 12 colunas por linha.
 */
export async function repeatAcrossMonths(input: {
  boardId: string;
  year: number;
  fromMonth: number;
  categoryId: string;
}): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const actor = await requireActor("plan:manage");
  const { boardId, year, fromMonth, categoryId } = input;
  if (fromMonth < 1 || fromMonth > 12) return { ok: false, error: "Mês inválido." };

  const db = createAdminClient();
  const { data: board } = await db
    .from("board")
    .select("organization_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return { ok: false, error: "Pipeline não encontrado." };

  const { data: origem } = await db
    .from("spend_plan")
    .select("amount")
    .eq("board_id", boardId)
    .eq("year", year)
    .eq("month", fromMonth)
    .eq("category_kind", KIND)
    .eq("category_id", categoryId)
    .maybeSingle();

  const amount = Number(origem?.amount ?? 0);
  const meses = Array.from({ length: 12 - fromMonth }, (_, i) => fromMonth + 1 + i);
  if (meses.length === 0) return { ok: true, changed: 0 };

  if (amount === 0) {
    const { error } = await db
      .from("spend_plan")
      .delete()
      .eq("board_id", boardId)
      .eq("year", year)
      .eq("category_kind", KIND)
      .eq("category_id", categoryId)
      .in("month", meses);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("spend_plan").upsert(
      meses.map((month) => ({
        organization_id: board.organization_id,
        board_id: boardId,
        year,
        month,
        category_kind: KIND,
        category_id: categoryId,
        amount,
        updated_by: actor.userId as string,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "board_id,year,month,category_kind,category_id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/prioridades");
  return { ok: true, changed: meses.length };
}
