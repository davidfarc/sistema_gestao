"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Tempo por tarefa (SPEC-FASE2 §E.2). Mede quanto tempo cada card consome,
 * para planejar prazos. NÃO é registro de jornada.
 *
 * Toda escrita passa por aqui: confere a sessão, se a pessoa enxerga o card e
 * se o pipeline tem o controle de tempo ligado. Ligar e pausar são as funções
 * `time_start` / `time_stop` do banco (migration 0041), numa transação.
 */

export interface RunningTimer {
  entryId: string;
  cardId: string;
  cardNumber: number;
  cardTitle: string;
  boardId: string;
  boardName: string;
  startedAt: string;
}

export interface MyTime {
  /** Cronômetro ligado agora (em qualquer pipeline), ou null. */
  running: RunningTimer | null;
  /** Segundos já fechados, por card, só da pessoa logada, neste pipeline. */
  totals: Record<string, number>;
  /** Segundos fechados hoje (dia de São Paulo), em qualquer pipeline. */
  todaySeconds: number;
}

export interface TimeEntryView {
  id: string;
  startedAt: string;
  endedAt: string | null;
  edited: boolean;
}

const MSG: Record<string, string> = {
  card_not_found: "Card não encontrado ou arquivado.",
  end_in_future: "A hora de parada não pode estar no futuro.",
  end_before_start: "A hora de parada precisa ser depois do início.",
};
const friendly = (message: string | undefined, fallback: string) =>
  MSG[Object.keys(MSG).find((k) => message?.includes(k)) ?? ""] ?? fallback;

/** Meia-noite de hoje em São Paulo, como instante. */
function startOfTodaySP(): Date {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new Date(`${ymd}T00:00:00-03:00`);
}

/** Meu tempo: cronômetro ligado, totais por card do pipeline e o total de hoje. */
export async function loadMyTime(boardId: string): Promise<MyTime> {
  const actor = await requireActor();
  const db = await createClient(); // sessão → RLS (só os próprios períodos)
  const me = actor.userId as string;
  const today = startOfTodaySP().toISOString();

  const [runningRes, boardRes, todayRes] = await Promise.all([
    db
      .from("time_entry")
      .select("id, card_id, board_id, started_at")
      .eq("user_id", me)
      .is("ended_at", null)
      .maybeSingle(),
    db
      .from("time_entry")
      .select("card_id, started_at, ended_at")
      .eq("user_id", me)
      .eq("board_id", boardId)
      .not("ended_at", "is", null)
      .limit(5000),
    db
      .from("time_entry")
      .select("started_at, ended_at")
      .eq("user_id", me)
      .not("ended_at", "is", null)
      .gt("ended_at", today),
  ]);

  const totals: Record<string, number> = {};
  for (const e of boardRes.data ?? []) {
    const s = (Date.parse(e.ended_at as string) - Date.parse(e.started_at)) / 1000;
    totals[e.card_id] = (totals[e.card_id] ?? 0) + s;
  }
  let todaySeconds = 0;
  const t0 = Date.parse(today);
  for (const e of todayRes.data ?? []) {
    todaySeconds += (Date.parse(e.ended_at as string) - Math.max(Date.parse(e.started_at), t0)) / 1000;
  }

  let running: RunningTimer | null = null;
  const r = runningRes.data;
  if (r) {
    const [{ data: card }, { data: board }] = await Promise.all([
      db.from("card").select("number, title").eq("id", r.card_id).maybeSingle(),
      db.from("board").select("name").eq("id", r.board_id).maybeSingle(),
    ]);
    running = {
      entryId: r.id,
      cardId: r.card_id,
      cardNumber: Number(card?.number ?? 0),
      cardTitle: card?.title ?? "Card",
      boardId: r.board_id,
      boardName: board?.name ?? "",
      startedAt: r.started_at,
    };
  }
  return { running, totals, todaySeconds };
}

/** Liga o cronômetro no card (pausa o que estiver ligado). */
export async function startTimer(
  cardId: string,
): Promise<{ ok: true; pausedCardId: string | null } | { ok: false; error: string }> {
  const actor = await requireActor("card:read");
  const session = await createClient();
  const { data: card } = await session
    .from("card")
    .select("id, board_id, archived_at")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.archived_at) return { ok: false, error: "Card não encontrado ou arquivado." };
  const { data: board } = await session.from("board").select("*").eq("id", card.board_id).maybeSingle();
  if (!board?.time_tracking) {
    return { ok: false, error: "O controle de tempo não está ligado neste pipeline." };
  }
  const { data, error } = await createAdminClient().rpc("time_start", {
    p_user: actor.userId as string,
    p_card: cardId,
  });
  if (error) return { ok: false, error: friendly(error.message, "Não foi possível iniciar. Tente de novo.") };
  return { ok: true, pausedCardId: (data as { pausedCardId: string | null }).pausedCardId };
}

/**
 * Pausa o meu cronômetro. `stoppedAt` (ISO) informa a hora em que a pessoa de
 * fato parou, para corrigir um cronômetro esquecido ligado.
 */
export async function pauseTimer(stoppedAt?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor();
  let at: string | null = null;
  if (stoppedAt) {
    const t = Date.parse(stoppedAt);
    if (!Number.isFinite(t)) return { ok: false, error: "Hora inválida." };
    at = new Date(t).toISOString();
  }
  const db = createAdminClient();
  const { data: running } = await db
    .from("time_entry")
    .select("card_id")
    .eq("user_id", actor.userId as string)
    .is("ended_at", null)
    .maybeSingle();
  const { error } = await db.rpc("time_stop", { p_user: actor.userId as string, p_at: at });
  if (error) return { ok: false, error: friendly(error.message, "Não foi possível pausar. Tente de novo.") };
  if (at && running) await logEdit(running.card_id, actor.userId as string, "corrigiu a hora de parada do cronômetro");
  return { ok: true };
}

/** Meus períodos neste card (mais recentes primeiro). */
export async function loadMyEntries(cardId: string): Promise<TimeEntryView[]> {
  const actor = await requireActor();
  const { data } = await (await createClient())
    .from("time_entry")
    .select("id, started_at, ended_at, edited_at")
    .eq("user_id", actor.userId as string)
    .eq("card_id", cardId)
    .order("started_at", { ascending: false })
    .limit(30);
  return (data ?? []).map((e) => ({
    id: e.id,
    startedAt: e.started_at,
    endedAt: e.ended_at,
    edited: e.edited_at != null,
  }));
}

/** Corrige início e fim de um período MEU já encerrado. Fica no histórico do card. */
export async function editEntry(
  entryId: string,
  startedAt: string,
  endedAt: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor();
  const me = actor.userId as string;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "Datas inválidas." };
  if (end <= start) return { ok: false, error: "O fim precisa ser depois do início." };
  if (end > Date.now()) return { ok: false, error: "O fim não pode estar no futuro." };
  if (end - start > 24 * 3600_000) return { ok: false, error: "Um período não pode passar de 24 horas." };

  const db = createAdminClient();
  const { data: entry } = await db
    .from("time_entry")
    .select("id, card_id, user_id, ended_at")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry || entry.user_id !== me) return { ok: false, error: "Período não encontrado." };
  if (!entry.ended_at) return { ok: false, error: "Pause o cronômetro antes de corrigir este período." };

  // Não pode se sobrepor a outro período meu.
  const { count } = await db
    .from("time_entry")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me)
    .neq("id", entryId)
    .lt("started_at", new Date(end).toISOString())
    .or(`ended_at.is.null,ended_at.gt.${new Date(start).toISOString()}`);
  if ((count ?? 0) > 0) return { ok: false, error: "Esse horário se sobrepõe a outro período seu." };

  const { error } = await db
    .from("time_entry")
    .update({
      started_at: new Date(start).toISOString(),
      ended_at: new Date(end).toISOString(),
      edited_at: new Date().toISOString(),
    })
    .eq("id", entryId)
    .eq("user_id", me);
  if (error) return { ok: false, error: "Não foi possível gravar. Tente de novo." };
  await logEdit(entry.card_id, me, "corrigiu um período de tempo");
  return { ok: true };
}

async function logEdit(cardId: string, actorId: string, text: string) {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).maybeSingle();
  if (!card) return;
  await db.from("activity").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    actor_id: actorId,
    kind: "time_edited",
    payload: { text },
  });
}

/** Liga ou desliga, no pipeline, a visão "Minhas demandas" e o controle de tempo. */
export async function setBoardOptions(
  boardId: string,
  options: { myTasks: boolean; timeTracking: boolean; ownPanel?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("board:configure");
  // `own_panel` (0042) só vai quando muda: assim o resto salva mesmo antes da migration.
  const patch: Record<string, boolean> = {
    my_tasks: !!options.myTasks,
    time_tracking: !!options.timeTracking,
  };
  if (options.ownPanel !== undefined) patch.own_panel = !!options.ownPanel;
  const { error } = await createAdminClient()
    .from("board")
    .update(patch)
    .eq("id", boardId)
    .eq("organization_id", actor.organizationId as string);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("own_panel")
        ? "Falta aplicar a atualização do banco (migration 0042)."
        : error.message.includes("my_tasks")
        ? "Falta aplicar a atualização do banco (migration 0041)."
        : "Não foi possível salvar. Tente de novo.",
    };
  }
  return { ok: true };
}
