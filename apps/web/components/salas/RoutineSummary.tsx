"use client";

import Link from "next/link";
import clsx from "clsx";
import { CalendarClock, Eye } from "lucide-react";
import { formatBR, idSet, todayISO } from "@/lib/salas/logic";
import type { DailyRoutine, Room, Student, Vila } from "@/lib/salas/types";

// Resumo da Rotina de HOJE dentro do dashboard de Salas — portado do v2.7
// (linhas 1379-1459 do fonte). Só renderiza se houver alertas para a vila
// corrente: alunos com falta, atraso, +time ou observação no dia atual.

export default function RoutineSummary({
  vila,
  vilaRooms,
  students,
  dailyRoutine,
}: {
  vila: Vila;
  vilaRooms: Room[];
  students: Student[];
  dailyRoutine: Record<string, DailyRoutine> | undefined;
}) {
  const date = todayISO();
  const routine = dailyRoutine?.[date];
  if (!routine) return null;

  const absent = idSet(routine.absences);
  const early = idSet(routine.earlyDepartures);
  const extra = idSet(routine.extraTime);
  const notes = routine.studentNotes ?? {};

  const hasAny =
    absent.size > 0 || early.size > 0 || extra.size > 0 || Object.keys(notes).length > 0;
  if (!hasAny) return null;

  const vilaRoomIds = new Set(vilaRooms.map((r) => String(r.id).trim()));

  const irregular = students.filter((s) => {
    const sid = String(s.id ?? "").trim();
    if (!vilaRoomIds.has(String(s.roomId ?? "").trim())) return false;
    return absent.has(sid) || early.has(sid) || extra.has(sid) || !!notes[sid]?.trim();
  });

  if (irregular.length === 0) return null;

  const vilaAbsences = irregular.filter((s) => absent.has(String(s.id).trim())).length;
  const vilaEarly = irregular.filter((s) => early.has(String(s.id).trim())).length;
  const isVila2 = vila === "vila2";
  const accent = isVila2 ? "text-info border-info" : "text-success border-success";
  const bg = isVila2
    ? "bg-info/5 border-info/40"
    : "bg-success/5 border-success/40";

  return (
    <section className={clsx("rounded-2xl border p-5 shadow-premium-soft", bg)}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h4 className={clsx("flex items-center gap-2 font-headline font-bold", accent.split(" ")[0])}>
          <CalendarClock className="w-4 h-4" aria-hidden="true" />
          Resumo da Rotina ({vila.toUpperCase()}) — {formatBR(date)}
        </h4>
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-bold",
              vilaAbsences > 0 ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
            )}
          >
            {vilaAbsences} Faltas
          </span>
          <span
            className={clsx(
              "px-2.5 py-1 rounded-md text-xs font-bold",
              vilaEarly > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
            )}
          >
            {vilaEarly} Atrasos
          </span>
          <Link
            href="/salas/rotina"
            className="inline-flex items-center gap-1 bg-surface-lowest border border-surface-medium text-secondary hover:text-primary px-2.5 py-1 rounded-md text-xs font-semibold"
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Ver tudo
          </Link>
        </div>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {irregular.map((s) => {
          const sid = String(s.id).trim();
          const isAbs = absent.has(sid);
          const isEarly = early.has(sid);
          const isExtra = extra.has(sid);
          const note = notes[sid]?.trim();
          const borderTone = isAbs ? "border-l-danger" : "border-l-info";
          return (
            <div
              key={sid}
              className={clsx(
                "bg-surface-lowest rounded-lg border border-black/5 border-l-4 p-3",
                borderTone
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="text-sm text-primary truncate">{s.name}</strong>
                <div className="flex gap-1 shrink-0">
                  {isAbs && (
                    <span className="bg-danger/10 text-danger px-1.5 py-0.5 rounded text-[10px] font-bold">
                      FALTA
                    </span>
                  )}
                  {isEarly && (
                    <span className="bg-warning/10 text-warning px-1.5 py-0.5 rounded text-[10px] font-bold">
                      ATRASO
                    </span>
                  )}
                  {isExtra && (
                    <span className="bg-tertiary-fixed text-primary px-1.5 py-0.5 rounded text-[10px] font-bold">
                      + TIME
                    </span>
                  )}
                </div>
              </div>
              {note && <p className="mt-1.5 text-xs text-secondary italic">&ldquo;{note}&rdquo;</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
