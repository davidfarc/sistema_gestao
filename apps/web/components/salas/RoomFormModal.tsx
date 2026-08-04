"use client";

import { useEffect, useState } from "react";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { sameId } from "@/lib/salas/logic";
import type { Room, Vila } from "@/lib/salas/types";

// Cria/edita uma sala. Grava a coleção `rooms` inteira (add/edit) preservando a
// ordem original. Validação: nome obrigatório e único (case-insensitive).
export default function RoomFormModal({
  open,
  room,
  rooms,
  defaultVila,
  onClose,
}: {
  open: boolean;
  room: Room | null;
  rooms: Room[];
  defaultVila: Vila;
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [name, setName] = useState("");
  const [segmento, setSegmento] = useState<Vila>(defaultVila);

  useEffect(() => {
    if (open) {
      setName(room?.name ?? "");
      setSegmento((room?.segmento as Vila) ?? defaultVila);
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
    </Modal>
  );
}
