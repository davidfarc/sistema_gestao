import { DAYS, sameId } from "./logic";
import type { Room, Student, Vila } from "./types";

export interface ActivesoftStudent {
  id: string;
  name: string;
  roomName: string;
  birthDate: string | null;
}

export interface SyncResult {
  students: Student[];
  rooms: Room[];
  countNew: number;
  countUpdated: number;
  newRoomsCount: number;
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
  currentRooms: Room[]
): SyncResult {
  const rooms = [...currentRooms];
  const students = [...currentStudents];
  let countNew = 0;
  let countUpdated = 0;
  let newRoomsCount = 0;

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
    };

    const idx = students.findIndex((s) => sameId(s.id, src.id));
    if (idx >= 0) {
      const current = students[idx]!; // findIndex >= 0 garante o item
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

  return { students, rooms, countNew, countUpdated, newRoomsCount };
}
