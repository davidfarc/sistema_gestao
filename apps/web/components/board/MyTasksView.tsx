"use client";

import { AlertTriangle, CheckSquare, Clock, Pause, Play, History } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CardView, StageView } from "@/lib/board/types";
import {
  editEntry,
  loadMyEntries,
  loadMyTime,
  pauseTimer,
  startTimer,
  type MyTime,
  type TimeEntryView,
} from "@/lib/time/actions";
import {
  LONG_RUNNING_HOURS,
  fmtClock,
  fmtDateTime,
  fmtHours,
  fromLocalInput,
  toLocalInput,
} from "@/lib/time/format";

const today = () => new Date().toLocaleDateString("en-CA");

/**
 * "Minhas demandas": a visão do colaborador. Só os cards em que a pessoa é a
 * responsável, os atrasados primeiro, com o cronômetro de tempo por tarefa
 * quando o pipeline tem o controle de tempo ligado.
 */
export function MyTasksView({
  boardId,
  cards,
  stages,
  myUserId,
  timeTracking,
  onOpenCard,
  onMove,
}: {
  boardId: string;
  cards: CardView[];
  stages: StageView[];
  myUserId: string | null;
  timeTracking: boolean;
  onOpenCard: (id: string) => void;
  onMove: (cardId: string, stageId: string) => void;
}) {
  const [time, setTime] = useState<MyTime | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<CardView | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixAt, setFixAt] = useState("");

  const reload = useCallback(() => {
    if (!timeTracking) return;
    loadMyTime(boardId)
      .then(setTime)
      .catch(() => setTime({ running: null, totals: {}, todaySeconds: 0 }));
  }, [boardId, timeTracking]);

  useEffect(() => reload(), [reload]);

  // Relógio da tela: só anda enquanto há um cronômetro ligado.
  useEffect(() => {
    if (!time?.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [time?.running]);

  const category = useMemo(() => new Map(stages.map((s) => [s.id, s.category])), [stages]);
  const stageName = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);
  const mine = cards.filter((c) => c.assignee?.id === myUserId);
  const overdue = (c: CardView) => !!c.dueDate && c.dueDate.slice(0, 10) < today();
  const active = mine
    .filter((c) => category.get(c.stageId) !== "done")
    .sort(
      (a, b) =>
        Number(overdue(b)) - Number(overdue(a)) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.position - b.position,
    );
  const done = mine.filter((c) => category.get(c.stageId) === "done").slice(0, 30);

  const running = time?.running ?? null;
  const runningSeconds = running ? (now - Date.parse(running.startedAt)) / 1000 : 0;
  const longRunning = runningSeconds > LONG_RUNNING_HOURS * 3600;
  const cardSeconds = (id: string) =>
    (time?.totals[id] ?? 0) + (running?.cardId === id ? runningSeconds : 0);

  async function toggle(card: CardView) {
    setBusy(card.id);
    setError(null);
    try {
      const res = running?.cardId === card.id ? await pauseTimer() : await startTimer(card.id);
      if (!res.ok) setError(res.error);
      reload();
    } catch {
      setError("Não foi possível falar com o servidor. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  async function pauseRunning(at?: string) {
    setBusy("running");
    setError(null);
    try {
      const res = await pauseTimer(at);
      if (!res.ok) setError(res.error);
      else setFixing(false);
      reload();
    } catch {
      setError("Não foi possível falar com o servidor. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  if (!myUserId) return null;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      {timeTracking && (
        <section
          aria-label="Cronômetro"
          className={
            "flex flex-wrap items-center gap-3 rounded-xl border p-4 " +
            (running ? (longRunning ? "border-amber-300 bg-amber-50" : "border-primary/40 bg-primary/5") : "border-neutral-200 bg-white")
          }
        >
          <div className="min-w-0 flex-1">
            {running ? (
              <>
                <p className="text-sm font-semibold text-neutral-800">
                  Contando o tempo em #{running.cardNumber} · {running.cardTitle}
                  {running.boardId !== boardId && (
                    <span className="font-normal text-neutral-600"> ({running.boardName})</span>
                  )}
                </p>
                <p className="text-sm text-neutral-700">
                  Ligado há <span className="font-mono tabular-nums">{fmtClock(runningSeconds)}</span>. Ao
                  iniciar outra tarefa, esta pausa sozinha.
                </p>
                {longRunning && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    Mais de {LONG_RUNNING_HOURS} horas seguidas. Se esqueceu ligado, informe a hora em que
                    parou.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-neutral-800">Nenhuma tarefa em andamento</p>
                <p className="text-sm text-neutral-700">
                  Clique em “Iniciar” no card em que vai trabalhar.
                </p>
              </>
            )}
            <p className="mt-1 text-xs text-neutral-600">
              Hoje: <span className="font-mono tabular-nums">{fmtHours((time?.todaySeconds ?? 0) + runningSeconds)}</span>
            </p>
          </div>
          {running && !fixing && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setFixAt(toLocalInput(new Date().toISOString()));
                  setFixing(true);
                }}
                className="min-h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Parei em outro horário
              </button>
              <button
                type="button"
                onClick={() => pauseRunning()}
                disabled={busy === "running"}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
              >
                <Pause className="h-4 w-4" aria-hidden="true" /> Pausar
              </button>
            </div>
          )}
          {running && fixing && (
            <form
              className="flex w-full flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (fixAt) pauseRunning(fromLocalInput(fixAt));
              }}
            >
              <label className="grid gap-1 text-sm text-neutral-700">
                Hora em que parei
                <input
                  type="datetime-local"
                  value={fixAt}
                  onChange={(e) => setFixAt(e.target.value)}
                  min={toLocalInput(running.startedAt)}
                  max={toLocalInput(new Date().toISOString())}
                  required
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy === "running"}
                className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
              >
                Pausar nesse horário
              </button>
              <button
                type="button"
                onClick={() => setFixing(false)}
                className="min-h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-700"
              >
                Cancelar
              </button>
            </form>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section aria-labelledby="minhas-titulo" className="grid gap-3">
        <h2 id="minhas-titulo" className="text-lg font-semibold text-neutral-800">
          Minhas demandas <span className="text-sm font-normal text-neutral-600">({active.length})</span>
        </h2>
        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-600">
            Nenhum card com você como responsável neste pipeline.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((c) => {
              const isRunning = running?.cardId === c.id;
              const late = overdue(c);
              return (
                <article
                  key={c.id}
                  className={
                    "flex flex-col gap-3 rounded-xl border bg-white p-4 " +
                    (isRunning ? "border-primary ring-1 ring-primary" : late ? "border-red-300" : "border-neutral-200")
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
                      {stageName.get(c.stageId) ?? "?"}
                    </span>
                    {late && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Atrasado</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCard(c.id)}
                    className="text-left text-base font-semibold leading-snug text-neutral-800 hover:underline"
                  >
                    <span className="text-sm font-normal text-neutral-600">#{c.number}</span> {c.title}
                  </button>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-700">
                    <span className={late ? "font-semibold text-red-700" : ""}>
                      <Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                      {c.dueDate ? `Prazo ${new Date(c.dueDate.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR")}` : "Sem prazo"}
                    </span>
                    {c.checklist && c.checklist.total > 0 && (
                      <span>
                        <CheckSquare className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                        {c.checklist.done}/{c.checklist.total}
                      </span>
                    )}
                  </div>

                  {timeTracking && (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-100 px-3 py-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Meu tempo</p>
                        <p className="font-mono text-lg tabular-nums text-neutral-800">
                          {isRunning ? fmtClock(cardSeconds(c.id)) : fmtHours(cardSeconds(c.id))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setHistoryFor(c)}
                          title="Ver e corrigir meus períodos"
                          aria-label={`Ver e corrigir meus períodos em #${c.number}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-600 hover:bg-white"
                        >
                          <History className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(c)}
                          disabled={busy === c.id}
                          className={
                            "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-50 " +
                            (isRunning
                              ? "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
                              : "bg-primary text-white hover:bg-primary-high")
                          }
                        >
                          {isRunning ? (
                            <>
                              <Pause className="h-4 w-4" aria-hidden="true" /> Pausar
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4" aria-hidden="true" />
                              {cardSeconds(c.id) > 0 ? "Retomar" : "Iniciar"}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <label className="grid gap-1 text-sm text-neutral-700">
                    <span className="sr-only">Mover #{c.number} para</span>
                    <select
                      value={c.stageId}
                      onChange={(e) => onMove(c.id, e.target.value)}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id === c.stageId ? `Etapa: ${s.name}` : `Mover para: ${s.name}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="concluidas-titulo" className="grid gap-3">
          <h2 id="concluidas-titulo" className="text-lg font-semibold text-neutral-800">
            Concluídas <span className="text-sm font-normal text-neutral-600">({done.length})</span>
          </h2>
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {done.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <button type="button" onClick={() => onOpenCard(c.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                  <span className="text-neutral-600">#{c.number}</span> {c.title}
                </button>
                {timeTracking && (
                  <span className="font-mono tabular-nums text-neutral-700">{fmtHours(cardSeconds(c.id))}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {historyFor && (
        <EntriesDialog
          card={historyFor}
          onClose={() => setHistoryFor(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/** Meus períodos num card, com correção de início e fim. */
function EntriesDialog({
  card,
  onClose,
  onSaved,
}: {
  card: CardView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [entries, setEntries] = useState<TimeEntryView[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    loadMyEntries(card.id)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [card.id]);
  useEffect(() => load(), [load]);

  async function save(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await editEntry(id, fromLocalInput(start), fromLocalInput(end));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(null);
      load();
      onSaved();
    } catch {
      setError("Não foi possível gravar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-5">
          <div>
            <h2 className="text-lg font-semibold text-neutral-800">Meus períodos</h2>
            <p className="mt-1 text-sm text-neutral-600">
              #{card.number} {card.title}. Corrigir fica registrado no histórico do card.
            </p>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700">
            Fechar
          </button>
        </div>
        <div className="p-5">
          {entries === null ? (
            <div className="h-20 animate-pulse rounded-lg bg-neutral-100" aria-hidden="true" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-neutral-600">Nenhum período registrado neste card.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {entries.map((e) => (
                <li key={e.id} className="grid gap-2 px-3 py-2.5 text-sm">
                  {editing === e.id ? (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        save(e.id);
                      }}
                    >
                      <label className="grid gap-1">
                        Início
                        <input type="datetime-local" value={start} onChange={(ev) => setStart(ev.target.value)} required className="rounded-lg border border-neutral-300 px-2 py-1.5" />
                      </label>
                      <label className="grid gap-1">
                        Fim
                        <input type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} required className="rounded-lg border border-neutral-300 px-2 py-1.5" />
                      </label>
                      <button type="submit" disabled={saving} className="min-h-9 rounded-lg bg-primary px-3 font-medium text-white disabled:opacity-50">
                        Salvar
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="min-h-9 rounded-lg border border-neutral-300 px-3">
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 tabular-nums text-neutral-800">
                        {fmtDateTime(e.startedAt)} → {e.endedAt ? fmtDateTime(e.endedAt) : "agora"}
                        {e.edited && <span className="ml-1 text-xs text-neutral-600">(corrigido)</span>}
                      </span>
                      <span className="font-mono tabular-nums text-neutral-700">
                        {fmtHours(((e.endedAt ? Date.parse(e.endedAt) : Date.now()) - Date.parse(e.startedAt)) / 1000)}
                      </span>
                      {e.endedAt && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(e.id);
                            setStart(toLocalInput(e.startedAt));
                            setEnd(toLocalInput(e.endedAt!));
                            setError(null);
                          }}
                          className="min-h-9 rounded-lg px-2 font-medium text-primary hover:underline"
                        >
                          Corrigir
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
