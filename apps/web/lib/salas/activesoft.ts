import { DAYS, isBasicEducationRoom, sameId, todayISO } from "./logic";
import type { Room, Student, Vila } from "./types";

export interface ActivesoftStudent {
  id: string;
  name: string;
  roomName: string;
  birthDate: string | null;
  period?: string | null;
  status?: string | null;
}

export interface SyncResult {
  students: Student[];
  rooms: Room[];
  countNew: number;
  countUpdated: number;
  newRoomsCount: number;
  /** Alunos do cadastro (educação básica) que não vieram na lista do ActiveSoft. */
  missing: Student[];
  /** Quantos voltaram a constar na lista depois de terem sido marcados como fora. */
  countBack: number;
}

// Deduz Vila 1/2 pelo nome da turma — regra portada do v2.7.
function guessVila(roomName: string): Vila {
  const n = roomName.toLowerCase();
  if (/(vila\s*2|v2)/.test(n)) return "vila2";
  return "vila1";
}

function ageFrom(birthDate: string | null): number {
  if (!birthDate) return 0;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return 0;
  return new Date().getFullYear() - d.getFullYear();
}

// Aplica o resultado do ActiveSoft em cima do estado atual (rooms/students),
// preservando schedule/almoço quando o aluno já existe. Retorna próximos
// arrays completos (para escrever via write()).
export function applyActivesoftSync(
  incoming: ActivesoftStudent[],
  currentStudents: Student[],
  currentRooms: Room[],
  /** Marcar como fora da turma quem não veio na lista (o chamador confirma antes). */
  markMissing = false
): SyncResult {
  const rooms = [...currentRooms];
  const students = [...currentStudents];
  let countNew = 0;
  let countUpdated = 0;
  let newRoomsCount = 0;
  let countBack = 0;

  for (const src of incoming) {
    if (!src.id || !src.name) continue;

    let room = rooms.find(
      (r) => (r.name || "").toLowerCase() === src.roomName.toLowerCase()
    );
    if (!room) {
      room = {
        id: String(Date.now() + Math.floor(Math.random() * 1000)),
        name: src.roomName,
        segmento: guessVila(src.roomName),
      };
      rooms.push(room);
      newRoomsCount++;
    }

    const base: Student = {
      id: src.id,
      name: src.name,
      age: ageFrom(src.birthDate),
      roomId: String(room.id),
      schedule: { morning: [...DAYS], afternoon: [] },
      lunchDays: [],
      ...(src.period ? { period: src.period } : {}),
      ...(src.status ? { status: src.status } : {}),
      // Está na lista do ActiveSoft: é aluno da turma.
      left: false,
    };

    const idx = students.findIndex((s) => sameId(s.id, src.id));
    if (idx >= 0) {
      const current = students[idx]!; // findIndex >= 0 garante o item
      if (current.left) countBack++;
      const hasSchedule =
        (current.schedule?.morning ?? []).length > 0 ||
        (current.schedule?.afternoon ?? []).length > 0;
      const hasLunch = (current.lunchDays ?? []).length > 0;
      students[idx] = {
        ...current,
        ...base,
        schedule: hasSchedule ? current.schedule : base.schedule,
        lunchDays: hasLunch ? current.lunchDays : base.lunchDays,
      };
      countUpdated++;
    } else {
      students.push(base);
      countNew++;
    }
  }

  // Quem está no cadastro e NÃO veio na lista: transferido, cancelado ou de
  // outro ano. Só entram as turmas da educação básica; Colônia e Oficinas têm
  // alunos que não passam pelo ActiveSoft.
  const incomingIds = new Set(incoming.map((i) => String(i.id).trim()));
  const basicRoomIds = new Set(rooms.filter(isBasicEducationRoom).map((r) => String(r.id).trim()));
  const missing = students.filter(
    (s) =>
      !incomingIds.has(String(s.id).trim()) &&
      s.left !== true &&
      (!s.roomId || basicRoomIds.has(String(s.roomId).trim()))
  );
  if (markMissing && missing.length > 0) {
    const gone = new Set(missing.map((s) => String(s.id).trim()));
    const today = todayISO();
    for (let i = 0; i < students.length; i++) {
      const s = students[i]!;
      if (gone.has(String(s.id).trim())) students[i] = { ...s, left: true, leftAt: today };
    }
  }

  return { students, rooms, countNew, countUpdated, newRoomsCount, missing, countBack };
}
