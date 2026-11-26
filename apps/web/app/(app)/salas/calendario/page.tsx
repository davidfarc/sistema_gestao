"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useSalasData } from "@/lib/salas/SalasContext";
import { formatBR, routineEntries, todayISO, type RoutineEntry } from "@/lib/salas/logic";
import type { Room, Student, Vila } from "@/lib/salas/types";

// Calendário da rotina: falta, atraso, +time e observações por dia, inclusive
// as marcadas com antecedência (pela tela Rotina ou pelo Luix no WhatsApp).

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function Badges({ e }: { e: RoutineEntry }) {
  const tag = "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide";
  return (
    <span className="inline-flex flex-wrap gap-1">
      {e.falta && <span className={clsx(tag, "bg-danger/10 text-danger")}>Falta</span>}
      {e.atraso && <span className={clsx(tag, "bg-warning/15 text-warning")}>Atraso</span>}
      {e.maisTime && <span className={clsx(tag, "bg-info/10 text-info")}>+Time</span>}
      {e.nota && <span className={clsx(tag, "bg-primary/5 text-primary")}>Obs.</span>}
    </span>
  );
}

export default function CalendarioPage() {
  const { data, loading, error } = useSalasData();
  const today = todayISO();
  const [month, setMonth] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [vila, setVila] = useState<"" | Vila>("");
  const [picked, setPicked] = useState<string>(today);

  const studentOf = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of data?.students ?? []) map.set(String(s.id).trim(), s);
    return map;
  }, [data?.students]);
  const roomOf = useMemo(() => {
    const map = new Map<string, Room>();
    for (const r of data?.rooms ?? []) map.set(String(r.id).trim(), r);
    return map;
  }, [data?.rooms]);

  // Anotações por dia, já filtradas pela vila da turma do aluno.
  const byDay = useMemo(() => {
    const map = new Map<string, RoutineEntry[]>();
    for (const e of routineEntries(data?.dailyRoutine)) {
      const st = studentOf.get(e.studentId);
      const room = st ? roomOf.get(String(st.roomId ?? "").trim()) : undefined;
      const v: Vila = room?.segmento === "vila2" ? "vila2" : "vila1";
      if (vila && v !== vila) continue;
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return map;
  }, [data?.dailyRoutine, studentOf, roomOf, vila]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando calendário…</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar o calendário</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  const first = new Date(Date.UTC(month.y, month.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (d: number) =>
    setMonth(({ y, m }) => {
      const t = new Date(Date.UTC(y, m + d, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
    });
  const name = (id: string) => studentOf.get(id)?.name ?? `ID ${id}`;
  const turma = (id: string) => roomOf.get(String(studentOf.get(id)?.roomId ?? "").trim())?.name ?? "";
  const pickedList = (byDay.get(picked) ?? []).sort((a, b) => name(a.studentId).localeCompare(name(b.studentId), "pt-BR"));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" className="p-2 rounded-lg border border-surface-medium bg-surface-lowest text-primary">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <h2 className="text-lg font-headline font-bold text-primary min-w-44 text-center">
            {MONTHS[month.m]} {month.y}
          </h2>
          <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" className="p-2 rounded-lg border border-surface-medium bg-surface-lowest text-primary">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex bg-surface-lowest border border-surface-medium rounded-lg p-0.5" role="group" aria-label="Vila">
          {([["", "Todas"], ["vila1", "Vila 1"], ["vila2", "Vila 2"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setVila(v)}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-semibold",
                vila === v ? "bg-primary text-white" : "text-secondary hover:text-primary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface-lowest border border-black/5 rounded-2xl overflow-hidden shadow-premium-soft">
        <div className="grid grid-cols-7 bg-surface-low text-secondary text-xs font-bold uppercase tracking-wide">
          {WEEK.map((w) => (
            <div key={w} className="px-2 py-2 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-24 border-t border-surface-medium bg-surface-low/40" />;
            const date = iso(month.y, month.m, d);
            const list = byDay.get(date) ?? [];
            const weekend = i % 7 === 0 || i % 7 === 6;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPicked(date)}
                className={clsx(
                  "min-h-24 border-t border-l border-surface-medium p-1.5 text-left align-top hover:bg-surface-low",
                  weekend && "bg-surface-low/40",
                  picked === date && "ring-2 ring-inset ring-primary"
                )}
              >
                <span className={clsx("text-xs font-bold", date === today ? "rounded-full bg-primary px-1.5 py-0.5 text-white" : "text-secondary")}>
                  {d}
                </span>
                <span className="mt-1 flex flex-col gap-0.5">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.studentId} className="truncate text-[11px] text-primary">
                      {e.falta ? "● " : e.atraso ? "◐ " : "○ "}
                      {name(e.studentId).split(" ")[0]}
                    </span>
                  ))}
                  {list.length > 3 && <span className="text-[11px] font-semibold text-secondary">+{list.length - 3} mais</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-surface-lowest border border-black/5 rounded-2xl p-5 shadow-premium-soft">
        <h3 className="font-headline font-bold text-primary">
          {formatBR(picked)} · {pickedList.length} {pickedList.length === 1 ? "aluno" : "alunos"}
          {picked > today && <span className="ml-2 text-xs font-semibold text-warning">lembretes futuros</span>}
        </h3>
        {pickedList.length === 0 ? (
          <p className="mt-2 text-sm italic text-secondary">Nada anotado neste dia{vila ? " nesta vila" : ""}.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pickedList.map((e) => (
              <li key={e.studentId} className="border-t border-surface-medium pt-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-primary">{name(e.studentId)}</strong>
                  <span className="text-xs text-secondary">{turma(e.studentId)}</span>
                  <Badges e={e} />
                </div>
                {e.nota && <p className="mt-1 text-secondary">{e.nota}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
