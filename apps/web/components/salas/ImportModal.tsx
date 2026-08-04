"use client";

import { useState } from "react";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { DAYS, sameId } from "@/lib/salas/logic";
import type { Adult, Room, Student, Vila } from "@/lib/salas/types";

// Fatia uma linha por TAB (Excel), ou por | ou ;.
function splitLine(line: string): string[] {
  const tabs = line.split("\t");
  if (tabs.length > 1) return tabs.map((s) => s.trim());
  const pipes = line.split("|");
  if (pipes.length > 1) return pipes.map((s) => s.trim());
  return line.split(";").map((s) => s.trim());
}

interface Preview {
  ok: string[];
  skipped: string[];
  newRooms: number;
  updated: number;
  added: number;
}

// Import de Alunos (formato herdado do legado):
//   ID  Nome  Sala  [Almoço]  [Entrada]  [Saída]
// - Cria sala pelo nome se não existir.
// - Ao encontrar aluno com o mesmo ID, preserva schedule/lunchDays se já tinha.
export function ImportStudentsModal({
  open,
  students,
  rooms,
  onClose,
}: {
  open: boolean;
  students: Student[];
  rooms: Room[];
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [text, setText] = useState("");

  const submit = async () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error("Cole ao menos uma linha.");

    const nextStudents = [...students];
    const nextRooms = [...rooms];
    const p: Preview = { ok: [], skipped: [], newRooms: 0, updated: 0, added: 0 };

    for (const line of lines) {
      const [id, name, roomName] = splitLine(line);
      if (!id || !name || !roomName) {
        p.skipped.push(line);
        continue;
      }
      let room = nextRooms.find(
        (r) => (r.name || "").toLowerCase() === roomName.toLowerCase()
      );
      if (!room) {
        room = { id: String(Date.now() + Math.floor(Math.random() * 1000)), name: roomName };
        nextRooms.push(room);
        p.newRooms++;
      }
      const base: Student = {
        id,
        name,
        age: 0,
        roomId: String(room.id),
        schedule: { morning: [...DAYS], afternoon: [] },
        lunchDays: [],
      };
      const idx = nextStudents.findIndex((s) => sameId(s.id, id));
      if (idx >= 0) {
        const current = nextStudents[idx]!; // findIndex >= 0 garante o item
        const hasRoutine =
          (current.schedule?.morning ?? []).length > 0 ||
          (current.schedule?.afternoon ?? []).length > 0 ||
          (current.lunchDays ?? []).length > 0;
        nextStudents[idx] = {
          ...current,
          ...base,
          schedule: hasRoutine ? current.schedule : base.schedule,
          lunchDays: hasRoutine ? current.lunchDays : base.lunchDays,
        };
        p.updated++;
      } else {
        nextStudents.push(base);
        p.added++;
      }
      p.ok.push(line);
    }

    if (p.ok.length === 0) throw new Error("Nenhuma linha válida. Formato: ID<TAB>Nome<TAB>Sala.");

    if (p.newRooms > 0) await write("rooms", nextRooms);
    await write("students", nextStudents);
    alert(
      `Importação OK: ${p.added} novos, ${p.updated} atualizados, ${p.newRooms} salas criadas. ${p.skipped.length} linhas ignoradas.`
    );
  };

  return (
    <Modal
      open={open}
      title="Importar Alunos"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Importar"
      size="lg"
    >
      <div>
        <label className={fieldLabel}>Colunas (TAB, | ou ;)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="ID<TAB>Nome<TAB>Sala&#10;25&#9;Blair Louise&#9;Kids 1 A"
          className={`${fieldInput} font-mono text-xs`}
        />
        <p className="text-[11px] text-secondary mt-2">
          Formato: <code>ID · Nome · Sala</code>. Salas inexistentes são criadas automaticamente.
          Alunos com o mesmo ID são atualizados (preserva schedule/almoço se já cadastrados).
        </p>
      </div>
    </Modal>
  );
}

// Import de Equipe:  ID  Nome  Cargo(label)  Vila
// - Match por ID (ou nome, se nome > 3 chars).
// - Cargo aceita label OU id de staffType (case-insensitive match no label).
export function ImportAdultsModal({
  open,
  adults,
  staffTypes,
  onClose,
}: {
  open: boolean;
  adults: Adult[];
  staffTypes: { id: string; label: string; short?: string }[];
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [text, setText] = useState("");

  const resolveType = (input: string): string | undefined => {
    const q = (input || "").trim().toLowerCase();
    if (!q) return undefined;
    const byId = staffTypes.find((t) => t.id.toLowerCase() === q);
    if (byId) return byId.id;
    const byLabel = staffTypes.find((t) => t.label.toLowerCase() === q);
    if (byLabel) return byLabel.id;
    return undefined;
  };

  const normVila = (raw: string): Vila => {
    const v = (raw || "").toLowerCase().replace(/\s/g, "");
    return v === "vila2" || v === "2" ? "vila2" : "vila1";
  };

  const submit = async () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error("Cole ao menos uma linha.");

    const next = [...adults];
    let added = 0;
    let updated = 0;
    let unknownType = 0;

    for (const line of lines) {
      const parts = splitLine(line);
      let id = "";
      let name = "";
      let roleRaw = "";
      let vilaRaw = "";
      // As colunas podem faltar; o `?? ""` mantém tudo string (config estrita).
      if (parts.length >= 4) {
        id = parts[0] ?? "";
        name = parts[1] ?? "";
        roleRaw = parts[2] ?? "";
        vilaRaw = parts[3] ?? "";
      } else if (parts.length >= 2) {
        name = parts[0] ?? "";
        roleRaw = parts[1] ?? "";
        vilaRaw = parts[2] ?? "";
      }
      if (!name) continue;

      const type = resolveType(roleRaw);
      if (roleRaw && !type) unknownType++;
      const segmento = normVila(vilaRaw);

      const idx = next.findIndex(
        (a) => (id && sameId(a.id, id)) || (name.length > 3 && a.name === name)
      );
      if (idx >= 0) {
        const cur = next[idx]!; // findIndex >= 0 garante o item
        next[idx] = {
          ...cur,
          name: name || cur.name,
          type: type ?? cur.type,
          segmento: segmento ?? cur.segmento ?? "vila1",
        };
        updated++;
      } else {
        next.push({
          id: id || String(Date.now() + added),
          name,
          type,
          segmento,
          assignments: [],
        });
        added++;
      }
    }

    if (added === 0 && updated === 0) throw new Error("Nenhuma linha válida.");
    await write("adults", next);
    alert(
      `Importação OK: ${added} novos, ${updated} atualizados${
        unknownType > 0 ? ` — ${unknownType} cargo(s) não encontrados nos tipos cadastrados.` : "."
      }`
    );
  };

  return (
    <Modal
      open={open}
      title="Importar Equipe"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Importar"
      size="lg"
    >
      <div>
        <label className={fieldLabel}>Colunas (TAB, | ou ;)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="ID<TAB>Nome<TAB>Cargo<TAB>Vila&#10;10245&#9;Ana Maria&#9;Professor(a)&#9;vila1"
          className={`${fieldInput} font-mono text-xs`}
        />
        <p className="text-[11px] text-secondary mt-2">
          Formato: <code>ID · Nome · Cargo · Vila</code>. O cargo deve bater com um tipo cadastrado (nome ou ID).
          Colaboradores existentes (por ID ou nome) são atualizados.
        </p>
      </div>
    </Modal>
  );
}

