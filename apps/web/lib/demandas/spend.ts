"use server";

import { loadFieldValuesByBoard, loadFields } from "@/lib/board/actions";
import type { FieldValueRaw } from "@/lib/board/types";
import { DF } from "@/lib/demandas/fields";
import type { Bucket, Categoria, DemandRow, PlanCell, SpendData } from "@/lib/demandas/spendTypes";
import { createClient } from "@/lib/supabase/server";

/**
 * Tudo que os gráficos precisam, em uma leitura: as demandas classificadas por
 * fila e as células de planejamento. A agregação e os filtros acontecem no
 * cliente — são poucas dezenas de linhas e evita ida ao servidor a cada clique.
 */
export async function loadSpendData(boardId: string): Promise<SpendData | null> {
  const db = await createClient(); // sessão → RLS escopa

  const { data: board } = await db
    .from("board")
    .select("id, name, creation_form, purchase_done_stage_id")
    .eq("id", boardId)
    .is("archived_at", null)
    .maybeSingle();
  if (!board || board.creation_form !== "custom:demandas") return null;

  const [fields, allValues] = await Promise.all([
    loadFields(boardId),
    loadFieldValuesByBoard(boardId),
  ]);
  const fieldId = (name: string) => fields.find((f) => f.name === name)?.id ?? null;
  const idOrcamento = fieldId(DF.orcamento);
  const idArea = fieldId(DF.area);
  const idTipo = fieldId(DF.tipo);
  const idData = fieldId(DF.data);

  const opts = (name: string): Categoria[] =>
    (fields.find((f) => f.name === name)?.options ?? []).map((o) => ({ id: o.id, label: o.label }));

  const [cardsRes, stagesRes, rulesRes, priosRes, planRes] = await Promise.all([
    db
      .from("card")
      .select("id, number, title, stage_id")
      .eq("board_id", boardId)
      .is("archived_at", null),
    db.from("stage").select("id, position").eq("board_id", boardId),
    db
      .from("workflow_rule")
      .select("requirement_config")
      .eq("board_id", boardId)
      .eq("requirement", "prioritized")
      .eq("is_active", true),
    db
      .from("prioritization")
      .select("card_id")
      .eq("board_id", boardId)
      .is("archived_at", null),
    db.from("spend_plan").select("year, month, category_id, amount").eq("board_id", boardId).eq("category_kind", "area"),
  ]);

  const posOf = new Map((stagesRes.data ?? []).map((s) => [s.id as string, Number(s.position)]));
  const checkpointId = (rulesRes.data ?? [])
    .map((r) => (r.requirement_config as { checkpointStageId?: string } | null)?.checkpointStageId)
    .find((id): id is string => !!id);
  const checkpointPos = checkpointId != null ? posOf.get(checkpointId) : undefined;
  const comprado = board.purchase_done_stage_id as string | null;
  const compradoPos = comprado != null ? posOf.get(comprado) : undefined;
  const priorizados = new Set((priosRes.data ?? []).map((p) => p.card_id as string));

  const valuesByCard = new Map<string, FieldValueRaw[]>();
  for (const v of allValues) {
    const arr = valuesByCard.get(v.cardId) ?? [];
    arr.push(v.value);
    valuesByCard.set(v.cardId, arr);
  }

  const rows: DemandRow[] = [];
  for (const c of cardsRes.data ?? []) {
    const vals = valuesByCard.get(c.id) ?? [];
    const pick = (id: string | null) => (id ? vals.find((v) => v.fieldId === id) : undefined);

    // Só é demanda se tiver o campo de orçamento definido no pipeline; um card
    // solto (sem nenhum valor) não deve virar fatia de gráfico.
    const orc = pick(idOrcamento)?.number ?? null;
    const areaId = pick(idArea)?.text ?? null;
    const tipoId = pick(idTipo)?.text ?? null;
    const dataStr = pick(idData)?.date ?? null;

    let year: number | null = null;
    let month: number | null = null;
    if (dataStr) {
      // "2026-09-13" — fatiar em vez de new Date() evita o pulo de fuso que
      // jogaria o dia 1º para o mês anterior.
      const [y, m] = dataStr.split("-");
      year = Number(y);
      month = Number(m);
      if (!Number.isFinite(year) || !Number.isFinite(month)) {
        year = null;
        month = null;
      }
    }

    const pos = posOf.get(c.stage_id);
    let bucket: Bucket = "fora";
    if (pos != null && compradoPos != null && pos >= compradoPos) bucket = "realizado";
    else if (priorizados.has(c.id)) bucket = "priorizada";
    else if (checkpointPos != null && pos === checkpointPos) bucket = "analise";

    rows.push({
      cardId: c.id,
      number: Number(c.number),
      title: c.title,
      valor: orc,
      areaId,
      tipoId,
      year,
      month,
      bucket,
    });
  }

  const plan: PlanCell[] = (planRes.data ?? []).map((p) => ({
    year: Number(p.year),
    month: Number(p.month),
    categoryId: p.category_id as string,
    amount: Number(p.amount),
  }));

  const anos = [
    ...new Set([
      ...plan.map((p) => p.year),
      ...rows.map((r) => r.year).filter((y): y is number => y != null),
      new Date().getFullYear(),
    ]),
  ].sort((a, b) => a - b);

  return {
    boardId: board.id,
    boardName: board.name,
    rows,
    plan,
    areas: opts(DF.area),
    tipos: opts(DF.tipo),
    anos,
    semEtapaDeCompra: compradoPos == null,
  };
}
