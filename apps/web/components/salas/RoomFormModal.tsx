"use client";

import { useEffect, useState } from "react";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { sameId, sortRooms } from "@/lib/salas/logic";
import type { Adult, Room, Student, Vila } from "@/lib/salas/types";

// Cria/edita uma sala. Grava a coleção `rooms` inteira (add/edit) preservando a
// ordem original. Validação: nome obrigatório e único (case-insensitive).
export default function RoomFormModal({
  open,
  room,
  rooms,
  students = [],
  adults = [],
  defaultVila,
  onClose,
}: {
  open: boolean;
  room: Room | null;
  rooms: Room[];
  /** Para "Juntar com outra sala" (só na edição). */
  students?: Student[];
  adults?: Adult[];
  defaultVila: Vila;
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [name, setName] = useState("");
  const [segmento, setSegmento] = useState<Vila>(defaultVila);
  const [targetId, setTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(room?.name ?? "");
      setSegmento((room?.segmento as Vila) ?? defaultVila);
      setTargetId("");
      setMergeError(null);
    }
  }, [open, room, defaultVila]);

  const submit = async () => {
    const nm = name.trim();
    if (!nm) throw new Error("O nome da sala é obrigatório.");
    const dup = rooms.some(
      (r) => r?.name && r.name.toLowerCase() === nm.toLowerCase() && !sameId(r.id, room?.id ?? "")
    );
    if (dup) throw new Error(`Já existe uma sala com o nome "${nm}".`);

    const next: Room[] = room
      ? rooms.map((r) => (sameId(r.id, room.id) ? { ...r, name: nm, segmento } : r))
      : [...rooms, { id: Date.now().toString(), name: nm, segmento }];

    await write("rooms", next);
  };

  // Juntar: leva a equipe e os alunos desta sala para outra e exclui esta.
  // Serve quando a mesma turma ficou com dois nomes (ex.: o ActiveSoft passou a
  // atualizar "Little Kids C" e a equipe estava em "Little Kids 1 C").
  const others = room ? sortRooms(rooms.filter((r) => !sameId(r.id, room.id))) : [];
  const staffHere = room
    ? adults.filter((a) => (a.assignments ?? []).some((asn) => sameId(asn.roomId, room.id))).length
    : 0;
  const studentsHere = room ? students.filter((s) => sameId(s.roomId, room.id)).length : 0;

  const merge = async () => {
    if (!room || !targetId) return;
    const target = rooms.find((r) => sameId(r.id, targetId));
    if (!target) return;
    const ok = confirm(
      `Juntar "${room.name}" em "${target.name}"?\n\n` +
        `- ${staffHere} pessoa(s) da equipe e ${studentsHere} aluno(s) passam para "${target.name}";\n` +
        `- a sala "${room.name}" é excluída.\n\nNão dá para desfazer automaticamente.`
    );
    if (!ok) return;
    setMerging(true);
    setMergeError(null);
    try {
      const nextAdults = adults.map((a) => {
        const list = a.assignments ?? [];
        if (!list.some((asn) => sameId(asn.roomId, room.id))) return a;
        const moved = list.map((asn) => (sameId(asn.roomId, room.id) ? { ...asn, roomId: String(target.id) } : asn));
        // Sem alocações idênticas repetidas na sala de destino.
        const seen = new Set<string>();
        const unique = moved.filter((asn) => {
          const key = JSON.stringify([String(asn.roomId), asn.start, asn.end, [...(asn.days ?? [])].sort()]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return { ...a, assignments: unique };
      });
      const nextStudents = students.map((s) => (sameId(s.roomId, room.id) ? { ...s, roomId: String(target.id) } : s));
      // Equipe e alunos primeiro; a sala só sai depois que ninguém aponta para ela.
      await write("adults", nextAdults);
      if (studentsHere > 0) await write("students", nextStudents);
      await write(
        "rooms",
        rooms.filter((r) => !sameId(r.id, room.id))
      );
      onClose();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Não foi possível juntar as salas.");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Modal open={open} title={room ? "Editar Sala" : "Nova Sala"} onClose={onClose} onSubmit={submit}>
      <div>
        <label className={fieldLabel}>Nome da Sala</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={fieldInput} />
      </div>
      <div>
        <label className={fieldLabel}>Segmento (Vila)</label>
        <select value={segmento} onChange={(e) => setSegmento(e.target.value as Vila)} className={fieldInput}>
          <option value="vila1">Vila 1</option>
          <option value="vila2">Vila 2</option>
        </select>
      </div>
      {room && others.length > 0 && (
        <div className="rounded-lg border border-surface-medium p-3">
          <label className={fieldLabel}>Juntar com outra sala</label>
          <p className="mb-2 text-xs text-secondary">
            Leva a equipe ({staffHere}) e os alunos ({studentsHere}) desta sala para a sala escolhida e exclui esta.
            Use quando a mesma turma ficou com dois nomes.
          </p>
          <div className="flex flex-wrap gap-2">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={fieldInput}>
              <option value="">Escolha a sala de destino…</option>
              {others.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={merge}
              disabled={!targetId || merging}
              className="rounded-lg border border-danger/40 px-3 py-2 text-sm font-bold text-danger disabled:opacity-50"
            >
              {merging ? "Juntando…" : "Juntar e excluir esta sala"}
            </button>
          </div>
          {mergeError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {mergeError}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
