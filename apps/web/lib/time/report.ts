import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Relatórios de tempo por tarefa. Lê com o cliente de SESSÃO: o RLS da tabela
 * `time_entry` (migration 0041) já restringe a quem tem `time:read`, e só aos
 * cards que a pessoa enxerga. Quem chama confere a permissão antes.
 */

export interface TimeRow {
  id: string;
  userId: string;
  userName: string;
  cardId: string;
  cardNumber: number;
  cardTitle: string;
  boardId: string;
  boardName: string;
  stageName: string;
  /** Concluído agora (etapa de categoria "done"). */
  cardDone: boolean;
  startedAt: string;
  /** null = cronômetro ainda ligado. */
  endedAt: string | null;
  edited: boolean;
  /** Segundos dentro do período pedido (o período pode cortar o começo ou o fim). */
  seconds: number;
}

/** Período no fuso de São Paulo: de 00:00 de `from` até 23:59 de `to` (AAAA-MM-DD). */
export function periodBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00-03:00`),
    end: new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000),
  };
}

export function isoDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Períodos que tocam o intervalo, com nomes resolvidos. No máximo 20 mil. */
export async function loadTimeRows(from: string, to: string): Promise<TimeRow[]> {
  const db = await createClient();
  const { start, end } = periodBounds(from, to);
  const { data: entries } = await db
    .from("time_entry")
    .select("id, user_id, card_id, board_id, started_at, ended_at, edited_at")
    .lt("started_at", end.toISOString())
    .or(`ended_at.is.null,ended_at.gt.${start.toISOString()}`)
    .order("started_at")
    .limit(20000);
  const rows = entries ?? [];
  if (rows.length === 0) return [];

  const ids = <T,>(xs: T[]) => [...new Set(xs)];
  const cardIds = ids(rows.map((r) => r.card_id));
  const [cardsRes, boardsRes, usersRes] = await Promise.all([
    db.from("card").select("id, number, title, stage_id").in("id", cardIds.slice(0, 2000)),
    db.from("board").select("id, name").in("id", ids(rows.map((r) => r.board_id))),
    db.from("app_user").select("id, name, email").in("id", ids(rows.map((r) => r.user_id))),
  ]);
  const cards = new Map((cardsRes.data ?? []).map((c) => [c.id, c]));
  const stageIds = ids((cardsRes.data ?? []).map((c) => c.stage_id));
  const { data: stages } = stageIds.length
    ? await db.from("stage").select("id, name, category").in("id", stageIds)
    : { data: [] as { id: string; name: string; category: string }[] };
  const stageOf = new Map((stages ?? []).map((s) => [s.id, s]));
  const boards = new Map((boardsRes.data ?? []).map((b) => [b.id, b.name]));
  const users = new Map((usersRes.data ?? []).map((u) => [u.id, u.name || u.email]));

  const now = Date.now();
  return rows.map((r) => {
    const card = cards.get(r.card_id);
    const stage = card ? stageOf.get(card.stage_id) : undefined;
    const s = Math.max(Date.parse(r.started_at), start.getTime());
    const e = Math.min(r.ended_at ? Date.parse(r.ended_at) : now, end.getTime());
    return {
      id: r.id,
      userId: r.user_id,
      userName: users.get(r.user_id) ?? "?",
      cardId: r.card_id,
      cardNumber: Number(card?.number ?? 0),
      cardTitle: card?.title ?? "(card indisponível)",
      boardId: r.board_id,
      boardName: boards.get(r.board_id) ?? "?",
      stageName: stage?.name ?? "",
      cardDone: stage?.category === "done",
      startedAt: r.started_at,
      endedAt: r.ended_at,
      edited: r.edited_at != null,
      seconds: Math.max(0, (e - s) / 1000),
    };
  });
}

/** Totais por chave, em ordem decrescente de tempo. */
export function sumBy<K extends string>(rows: TimeRow[], key: (r: TimeRow) => K) {
  const m = new Map<K, { seconds: number; rows: TimeRow[] }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { seconds: 0, rows: [] };
    cur.seconds += r.seconds;
    cur.rows.push(r);
    m.set(k, cur);
  }
  return [...m.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
}
