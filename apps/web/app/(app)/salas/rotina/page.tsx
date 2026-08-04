"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertCircle, Search, Check, Minus } from "lucide-react";
import clsx from "clsx";
import { useSalasData } from "@/lib/salas/SalasContext";
import { idSet, todayISO, weekdayFromISO } from "@/lib/salas/logic";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import type { Room, Student, Vila } from "@/lib/salas/types";

function Flag({ on }: { on: boolean }) {
  return on ? (
    <Check className="w-4 h-4 text-success inline" aria-label="Sim" />
  ) : (
    <Minus className="w-3.5 h-3.5 text-secondary/50 inline" aria-label="Não" />
  );
}

const checkClass = "w-[18px] h-[18px] cursor-pointer accent-[var(--color-primary)]";

// Observação com estado local; grava ao sair do campo (onBlur).
function NoteInput({
  date,
  sid,
  initial,
  write,
}: {
  date: string;
  sid: string;
  initial: string;
  write: (path: string, value: unknown) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== initial) write(`dailyRoutine/${date}/studentNotes/${sid}`, v);
      }}
      placeholder="Nota rápida…"
      className="w-full bg-surface-low border border-surface-medium text-primary rounded-md px-2 py-1 text-sm"
    />
  );
}

export default function RotinaPage() {
  const { data, loading, error } = useSalasData();
  const write = useSalasWrite();
  const [date, setDate] = useState(todayISO());
  const [name, setName] = useState("");
  const [vila, setVila] = useState<"" | Vila>("");
  const [turma, setTurma] = useState("");

  const rooms = data?.rooms ?? [];
  const roomOf = useMemo(() => {
    const map = new Map<string, Room>();
    for (const r of rooms) map.set(String(r.id).trim(), r);
    return (roomId: Student["roomId"]) => map.get(String(roomId ?? "").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  const weekday = weekdayFromISO(date);
  const routine = data?.dailyRoutine?.[date];
  const absent = idSet(routine?.absences);
  const early = idSet(routine?.earlyDepartures);
  const extra = idSet(routine?.extraTime);
  const notes = routine?.studentNotes ?? {};

  const toggleField = (field: "absences" | "earlyDepartures" | "extraTime", sid: string, on: boolean) => {
    const current = { absences: absent, earlyDepartures: early, extraTime: extra }[field];
    const next = new Set(current);
    if (on) next.add(sid);
    else next.delete(sid);
    write(`dailyRoutine/${date}/${field}`, Array.from(next));
  };

  const present = useMemo(() => {
    if (!weekday) return [];
    const students = data?.students ?? [];
    return students.filter((s) => {
      const inDay =
        (s.schedule?.morning ?? []).includes(weekday) ||
        (s.schedule?.afternoon ?? []).includes(weekday);
      if (!inDay) return false;
      const room = roomOf(s.roomId);
      const matchName =
        !name || s.name.toLowerCase().includes(name.toLowerCase()) || String(s.id).includes(name);
      const matchTurma = !turma || (!!room && (room.name || "").toLowerCase().includes(turma.toLowerCase()));
      const matchVila = !vila || (room?.segmento === "vila2" ? "vila2" : "vila1") === vila;
      return matchName && matchTurma && matchVila;
    });
  }, [data?.students, weekday, name, turma, vila, roomOf]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando rotina…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar a rotina</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Filtrar nome</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" aria-hidden="true" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Buscar aluno…"
              className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="w-36">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Vila</label>
          <select
            value={vila}
            onChange={(e) => setVila(e.target.value as "" | Vila)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="vila1">Vila 1</option>
            <option value="vila2">Vila 2</option>
          </select>
        </div>
        <div className="w-40">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Turma</label>
          <input
            value={turma}
            onChange={(e) => setTurma(e.target.value)}
            placeholder="Kids 1…"
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {!weekday ? (
        <div className="text-center py-16 text-secondary italic">
          A data selecionada é fim de semana — sem rotina letiva.
        </div>
      ) : (
        <div className="bg-surface-lowest border border-black/5 rounded-2xl overflow-hidden shadow-premium-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-low text-secondary text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold px-4 py-3">Aluno</th>
                  <th className="text-left font-semibold px-4 py-3">Turma</th>
                  <th className="text-center font-semibold px-4 py-3">Falta</th>
                  <th className="text-center font-semibold px-4 py-3">Atraso</th>
                  <th className="text-center font-semibold px-4 py-3">+ Time</th>
                  <th className="text-center font-semibold px-4 py-3">Almoço</th>
                  <th className="text-left font-semibold px-4 py-3">Observação</th>
                </tr>
              </thead>
              <tbody>
                {present.map((s) => {
                  const sid = String(s.id).trim();
                  const room = roomOf(s.roomId);
                  const lunch = (s.lunchDays ?? []).includes(weekday);
                  return (
                    <tr key={sid} className="border-t border-surface-medium hover:bg-surface-low/60">
                      <td className="px-4 py-3 font-semibold text-primary">{s.name}</td>
                      <td className="px-4 py-3 text-secondary">{room ? room.name : "Pátio"}</td>
                      <td className={clsx("px-4 py-3 text-center", absent.has(sid) && "bg-danger/5")}>
                        <input
                          type="checkbox"
                          checked={absent.has(sid)}
                          onChange={(e) => toggleField("absences", sid, e.target.checked)}
                          className={checkClass}
                          aria-label={`Falta de ${s.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={early.has(sid)}
                          onChange={(e) => toggleField("earlyDepartures", sid, e.target.checked)}
                          className={checkClass}
                          aria-label={`Atraso de ${s.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={extra.has(sid)}
                          onChange={(e) => toggleField("extraTime", sid, e.target.checked)}
                          className={checkClass}
                          aria-label={`Tempo extra de ${s.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Flag on={lunch} />
                      </td>
                      <td className="px-4 py-3 w-64">
                        <NoteInput date={date} sid={sid} initial={notes[sid] ?? ""} write={write} />
                      </td>
                    </tr>
                  );
                })}
                {present.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-secondary italic">
                      Nenhum aluno encontrado com estes filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
