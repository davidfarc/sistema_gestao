"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { DAYS, sameId, sortRooms } from "@/lib/salas/logic";
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
    </Modal>
  );
}
