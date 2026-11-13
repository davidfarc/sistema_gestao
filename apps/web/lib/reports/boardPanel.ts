import "server-only";

import { byName } from "@/lib/board/queries";
import type { FieldOption, StageCategory } from "@/lib/board/types";
import { createClient } from "@/lib/supabase/server";
import { isoDay, periodBounds } from "@/lib/time/report";

/**
 * Painel próprio de um pipeline (opção "Painel próprio em Painéis", 0042).
 * Tudo é lido com o cliente de SESSÃO: o RLS já limita aos cards que a pessoa
 * enxerga, e o tempo da equipe só vem para quem tem `time:read`.
 * Genérico: as quebras saem das próprias propriedades de opção do pipeline,
 * sem nome de campo fixo no código.
 */

export interface PanelStage {
  id: string;
  name: string;
  category: StageCategory;
  countsRework: boolean;
  cards: number;
}

/** Uma linha de gráfico: total e quantos cards em cada etapa. */
export interface StackRow {
  label: string;
  total: number;
  byStage: Record<string, number>;
}

export interface ValueRow {
  label: string;
  value: number | null;
}

export interface Breakdown {
  fieldId: string;
  fieldName: string;
  rows: StackRow[];
  /** Soma de emendas por opção (só com etapa de emenda). */
  rework: ValueRow[] | null;
  /** Horas médias por card concluído, por opção (só com `time:read`). */
  avgHours: ValueRow[] | null;
}

export interface OverdueCard {
  id: string;
  number: number;
  title: string;
  dueDate: string;
  days: number;
  assignee: string | null;
}

export interface BoardPanel {
  id: string;
  name: string;
  stages: PanelStage[];
  overdue: OverdueCard[];
  byAssignee: StackRow[];
  breakdowns: Breakdown[];
  hasRework: boolean;
  /** Média de dias da criação à conclusão, entre os concluídos. */
  avgDaysToDone: number | null;
  doneCount: number;
  /** % dos concluídos sem nenhuma emenda (só com etapa de emenda). */
  doneWithoutRework: number | null;
  /** Horas registradas hoje por pessoa (só com `time:read` e cronômetro ligado). */
  hoursToday: ValueRow[] | null;
}

/** Pipelines com painel próprio que a pessoa enxerga (para as abas). */
export async function loadPanelBoards(): Promise<{ id: string; name: string }[]> {
  const db = await createClient();
  const { data } = await db.from("board").select("*").is("archived_at", null);
  return ((data ?? []) as { id: string; name: string; own_panel?: boolean }[])
    .filter((b) => b.own_panel === true)
    .map((b) => ({ id: b.id, name: b.name }))
    .sort(byName);
}

const DAY = 86_400_000;

export async function loadBoardPanel(boardId: string, canSeeTime: boolean): Promise<BoardPanel | null> {
  const db = await createClient();
  const { data: board } = await db
    .from("board")
    .select("*")
    .eq("id", boardId)
    .is("archived_at", null)
    .maybeSingle();
  if (!board) return null;

  const [stagesRes, cardsRes, fieldsRes] = await Promise.all([
    db.from("stage").select("*").eq("board_id", boardId).order("position"),
    db
      .from("card")
      .select("id, number, title, stage_id, due_date, created_at, completed_at")
      .eq("board_id", boardId)
      .is("archived_at", null),
    db
      .from("field_definition")
      .select("id, name, type, config, position")
      .eq("board_id", boardId)
      .in("type", ["select", "status"])
      .order("position"),
  ]);

  const stagesRaw = (stagesRes.data ?? []) as {
    id: string;
    name: string;
    category: StageCategory;
    counts_rework?: boolean;
  }[];
  const cards = cardsRes.data ?? [];
  const cardIds = cards.map((c) => c.id);
  const categoryOf = new Map(stagesRaw.map((s) => [s.id, s.category]));
  const isDone = (stageId: string) => categoryOf.get(stageId) === "done";
  const hasRework = stagesRaw.some((s) => s.counts_rework === true);

  // Responsável, emendas e valores das propriedades de opção.
  const assigneeOf = new Map<string, string>();
  const reworkOf = new Map<string, number>();
  const optionOf = new Map<string, string>(); // `${cardId}|${fieldId}` → id da opção
  const nameOf = new Map<string, string>();
  if (cardIds.length > 0) {
    const fieldIds = (fieldsRes.data ?? []).map((f) => f.id);
    const [assigns, rework, values] = await Promise.all([
      db.from("assignment").select("card_id, user_id").is("stage_id", null).in("card_id", cardIds),
      hasRework
        ? db.from("card").select("id, rework_count").in("id", cardIds)
        : Promise.resolve({ data: [] as { id: string; rework_count: number }[] }),
      fieldIds.length > 0
        ? db
            .from("field_value")
            .select("card_id, field_definition_id, value_text")
            .in("card_id", cardIds)
            .in("field_definition_id", fieldIds)
        : Promise.resolve({ data: [] as { card_id: string; field_definition_id: string; value_text: string | null }[] }),
    ]);
    for (const a of assigns.data ?? []) assigneeOf.set(a.card_id, a.user_id);
    for (const r of rework.data ?? []) reworkOf.set(r.id, Number(r.rework_count ?? 0));
    for (const v of values.data ?? []) {
      if (v.value_text) optionOf.set(`${v.card_id}|${v.field_definition_id}`, v.value_text);
    }
  }

  // Tempo: totais por card (todos os períodos) e horas de hoje por pessoa.
  const secondsOf = new Map<string, number>();
  const todayOf = new Map<string, number>();
  const timeOn = canSeeTime && board.time_tracking === true;
  if (timeOn && cardIds.length > 0) {
    const { data: entries } = await db
      .from("time_entry")
      .select("user_id, card_id, started_at, ended_at")
      .eq("board_id", boardId)
      .limit(20000);
    const now = Date.now();
    const today = isoDay(new Date());
    const { start: dayStart, end: dayEnd } = periodBounds(today, today);
    for (const e of entries ?? []) {
      const s = new Date(e.started_at).getTime();
      const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
      secondsOf.set(e.card_id, (secondsOf.get(e.card_id) ?? 0) + Math.max(0, end - s) / 1000);
      const clip = Math.min(end, dayEnd.getTime()) - Math.max(s, dayStart.getTime());
      if (clip > 0) todayOf.set(e.user_id, (todayOf.get(e.user_id) ?? 0) + clip / 1000);
    }
  }

  const people = new Set<string>([...assigneeOf.values(), ...todayOf.keys()]);
  if (people.size > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email").in("id", [...people]);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  const stackBy = (keyOf: (c: (typeof cards)[number]) => string): StackRow[] => {
    const rows = new Map<string, StackRow>();
    for (const c of cards) {
      const label = keyOf(c);
      const row = rows.get(label) ?? { label, total: 0, byStage: {} };
      row.total += 1;
      row.byStage[c.stage_id] = (row.byStage[c.stage_id] ?? 0) + 1;
      rows.set(label, row);
    }
    return [...rows.values()];
  };

  const SEM = "Sem responsável";
  const byAssignee = stackBy((c) => {
    const uid = assigneeOf.get(c.id);
    return uid ? (nameOf.get(uid) ?? "?") : SEM;
  }).sort((a, b) => (a.label === SEM ? 1 : b.label === SEM ? -1 : a.label.localeCompare(b.label, "pt-BR")));

  const doneCards = cards.filter((c) => isDone(c.stage_id));

  const breakdowns: Breakdown[] = (fieldsRes.data ?? []).map((f) => {
    const options = ((f.config as { options?: FieldOption[] } | null)?.options ?? []) as FieldOption[];
    const labelOf = (c: (typeof cards)[number]) => {
      const id = optionOf.get(`${c.id}|${f.id}`);
      return options.find((o) => o.id === id)?.label ?? "Não informado";
    };
    const order = [...options.map((o) => o.label), "Não informado"];
    const rows = stackBy(labelOf).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    const perOption = (pick: (cs: typeof cards) => number | null): ValueRow[] =>
      options.map((o) => ({ label: o.label, value: pick(cards.filter((c) => labelOf(c) === o.label)) }));
    return {
      fieldId: f.id,
      fieldName: f.name,
      rows,
      rework: hasRework ? perOption((cs) => cs.reduce((n, c) => n + (reworkOf.get(c.id) ?? 0), 0)) : null,
      avgHours: timeOn
        ? perOption((cs) => {
            const done = cs.filter((c) => isDone(c.stage_id) && secondsOf.has(c.id));
            if (done.length === 0) return null;
            return done.reduce((n, c) => n + (secondsOf.get(c.id) ?? 0), 0) / done.length / 3600;
          })
        : null,
    };
  });

  const durations = doneCards
    .filter((c) => c.completed_at)
    .map((c) => (new Date(c.completed_at as string).getTime() - new Date(c.created_at).getTime()) / DAY);
  const today = isoDay(new Date());
  const overdue: OverdueCard[] = cards
    .filter((c) => c.due_date && !isDone(c.stage_id) && c.due_date.slice(0, 10) < today)
    .map((c) => {
      const due = (c.due_date as string).slice(0, 10);
      const uid = assigneeOf.get(c.id);
      return {
        id: c.id,
        number: Number(c.number),
        title: c.title,
        dueDate: due,
        days: Math.round((new Date(`${today}T12:00`).getTime() - new Date(`${due}T12:00`).getTime()) / DAY),
        assignee: uid ? (nameOf.get(uid) ?? null) : null,
      };
    })
    .sort((a, b) => b.days - a.days);

  return {
    id: board.id,
    name: board.name,
    stages: stagesRaw.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      countsRework: s.counts_rework === true,
      cards: cards.filter((c) => c.stage_id === s.id).length,
    })),
    overdue,
    byAssignee,
    breakdowns,
    hasRework,
    avgDaysToDone: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    doneCount: doneCards.length,
    doneWithoutRework:
      hasRework && doneCards.length
        ? Math.round((doneCards.filter((c) => !reworkOf.get(c.id)).length / doneCards.length) * 100)
        : null,
    hoursToday: timeOn
      ? [...todayOf.entries()]
          .map(([uid, s]) => ({ label: nameOf.get(uid) ?? "?", value: s / 3600 }))
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
      : null,
  };
}
