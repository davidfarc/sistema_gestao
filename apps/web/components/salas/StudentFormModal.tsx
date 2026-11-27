"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { DAYS, formatBR, routineEntries, sameId, sortRooms } from "@/lib/salas/logic";
import { useSalasData } from "@/lib/salas/SalasContext";
import { loadStudentGuardians, type GuardianView } from "@/lib/salas/guardianActions";
import type { Day, Room, Student } from "@/lib/salas/types";

const DAY_SHORT: Record<Day, string> = {
  segunda: "S",
  terca: "T",
  quarta: "Q",
  quinta: "Q",
  sexta: "S",
};

function DayPicker({ value, onToggle }: { value: Set<Day>; onToggle: (d: Day) => void }) {
  return (
    <div className="flex gap-1.5">
      {DAYS.map((d) => (
        <button
          type="button"
          key={d}
          onClick={() => onToggle(d)}
          title={d}
          className={clsx(
            "w-9 h-9 rounded-lg text-xs font-bold border transition-colors",
            value.has(d)
              ? "bg-primary text-white border-primary"
              : "bg-surface-low text-secondary border-surface-medium hover:border-primary"
          )}
        >
          {DAY_SHORT[d]}
        </button>
      ))}
    </div>
  );
}

// Cria/edita aluno. Grava a coleção `students` inteira (preserva campos extras
// via spread do aluno original). ID imutável na edição.
export default function StudentFormModal({
  open,
  student,
  students,
  rooms,
  onClose,
}: {
  open: boolean;
  student: Student | null;
  students: Student[];
  rooms: Room[];
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [roomId, setRoomId] = useState("");
  const [morning, setMorning] = useState<Set<Day>>(new Set());
  const [afternoon, setAfternoon] = useState<Set<Day>>(new Set());
  const [lunch, setLunch] = useState<Set<Day>>(new Set());
  const [left, setLeft] = useState(false);
  const { data: salas } = useSalasData();
  const history = student ? routineEntries(salas?.dailyRoutine, student.id) : [];

  // Responsáveis vindos do ActiveSoft (importação de alunos). Sem cadastro, a seção some.
  const [guardians, setGuardians] = useState<GuardianView[]>([]);
  useEffect(() => {
    if (!student) return setGuardians([]);
    let alive = true;
    loadStudentGuardians(String(student.id))
      .then((g) => alive && setGuardians(g))
      .catch(() => alive && setGuardians([]));
    return () => {
      alive = false;
    };
  }, [student]);

  const sorted = sortRooms(rooms);

  useEffect(() => {
    if (!open) return;
    setId(student ? String(student.id) : "");
    setName(student?.name ?? "");
    setAge(student?.age != null ? String(student.age) : "");
    setRoomId(student ? String(student.roomId ?? "") : String(sorted[0]?.id ?? ""));
    setMorning(new Set((student?.schedule?.morning ?? (student ? [] : DAYS)) as Day[]));
    setAfternoon(new Set((student?.schedule?.afternoon ?? []) as Day[]));
    setLunch(new Set((student?.lunchDays ?? []) as Day[]));
    setLeft(student?.left === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student]);

  const toggler = (setter: React.Dispatch<React.SetStateAction<Set<Day>>>) => (d: Day) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const submit = async () => {
    const nid = id.trim();
    const nm = name.trim();
    if (!nid || !nm) throw new Error("ID e Nome são obrigatórios.");
    const dup = students.some((s) => sameId(s.id, nid) && !sameId(s.id, student?.id ?? ""));
    if (dup) throw new Error(`Já existe um aluno com o ID "${nid}".`);

    const payload: Student = {
      ...(student ?? {}),
      id: nid,
      name: nm,
      age: parseInt(age, 10) || 0,
      roomId,
      schedule: { morning: Array.from(morning), afternoon: Array.from(afternoon) },
      lunchDays: Array.from(lunch),
      left,
      ...(left && !student?.leftAt ? { leftAt: new Date().toISOString().slice(0, 10) } : {}),
    };

    const next = student
      ? students.map((s) => (sameId(s.id, student.id) ? payload : s))
      : [...students, payload];

    await write("students", next);
  };

  return (
    <Modal open={open} title={student ? "Editar Aluno" : "Cadastrar Aluno"} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-[90px_1fr] gap-3">
        <div>
          <label className={fieldLabel}>ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!student}
            className={clsx(fieldInput, !!student && "opacity-60")}
          />
        </div>
        <div>
          <label className={fieldLabel}>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={fieldInput} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Idade</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className={fieldInput}
          />
        </div>
        <div>
          <label className={fieldLabel}>Turma</label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={fieldInput}>
            {sorted.map((r) => (
              <option key={String(r.id)} value={String(r.id)}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={fieldLabel}>Turno Manhã</label>
        <DayPicker value={morning} onToggle={toggler(setMorning)} />
      </div>
      <div>
        <label className={fieldLabel}>Turno Tarde</label>
        <DayPicker value={afternoon} onToggle={toggler(setAfternoon)} />
      </div>
      <div>
        <label className={fieldLabel}>Almoço</label>
        <DayPicker value={lunch} onToggle={toggler(setLunch)} />
      </div>
      {guardians.length > 0 && (
        <div>
          <label className={fieldLabel}>Responsáveis</label>
          <ul className="grid gap-1 text-sm">
            {guardians.map((g) => (
              <li key={g.slot} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-secondary">{g.relation}</span>
                <span className="text-primary">{g.name}</span>
                <span className="tabular-nums text-secondary">{showPhone(g.phone)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {student && (
        <div>
          <label className={fieldLabel}>Histórico da rotina</label>
          {history.length === 0 ? (
            <p className="text-xs italic text-secondary">Nenhuma falta, atraso, +time ou observação registrada.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-surface-medium text-sm">
              {history.map((e) => (
                <li key={e.date} className="border-b border-surface-medium px-3 py-2 last:border-b-0">
                  <span className="font-semibold text-primary">{formatBR(e.date)}</span>
                  <span className="ml-2 text-xs font-bold uppercase tracking-wide text-secondary">
                    {[e.falta && "Falta", e.atraso && "Atraso", e.maisTime && "+Time"].filter(Boolean).join(" · ")}
                  </span>
                  {e.nota && <p className="text-secondary">{e.nota}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label className="flex items-start gap-2.5 text-sm text-primary">
        <input type="checkbox" checked={left} onChange={(e) => setLeft(e.target.checked)} className="mt-0.5" />
        <span>
          Fora da turma (transferido ou cancelado)
          <span className="block text-xs text-secondary">
            Continua no cadastro e aparece riscado, mas não entra em nenhuma contagem.
          </span>
        </span>
      </label>
    </Modal>
  );
}

/** "+5584988881111" → "(84) 98888-1111"; sem celular, avisa. */
function showPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d ? p : "sem celular";
}
