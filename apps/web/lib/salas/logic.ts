// Lógica pura portada do app v2.7 (classe EscolaSim). Sem efeitos colaterais —
// só cálculo de presença, vila e ratios, para reuso em componentes e testes.

import type { Adult, Assignment, Day, Room, Shift, StaffType, Student, Vila } from "./types";

export const DAYS: Day[] = ["segunda", "terca", "quarta", "quinta", "sexta"];

export const DAY_LABELS: Record<Day, string> = {
  segunda: "Segunda-Feira",
  terca: "Terça-Feira",
  quarta: "Quarta-Feira",
  quinta: "Quinta-Feira",
  sexta: "Sexta-Feira",
};

const sid = (v: unknown) => String(v ?? "").trim();
export const sameId = (a: unknown, b: unknown) => sid(a) === sid(b);

const parseTime = (t: string) => parseInt(t.replace(":", ""), 10);

// RTDB pode devolver coleções como array OU objeto (chaves esparsas). Normaliza.
export function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter(Boolean) as T[];
  if (v && typeof v === "object") return Object.values(v as Record<string, T>).filter(Boolean);
  return [];
}

export function checkStaffAssignment(
  asn: Assignment | undefined,
  day: Day,
  shift: Shift,
  roomId: string | number | null = null
): boolean {
  if (!asn) return false;
  if (roomId != null && sid(asn.roomId) !== sid(roomId)) return false;
  const days = asn.days ?? DAYS;
  if (!days.includes(day)) return false;
  if (!asn.start || !asn.end) return false;
  const start = parseTime(asn.start);
  const end = parseTime(asn.end);
  return shift === "morning" ? start < 1200 && end > 700 : start < 1800 && end > 1300;
}

export const isAdultPresent = (a: Adult, day: Day, shift: Shift) =>
  Array.isArray(a.assignments) && a.assignments.some((x) => checkStaffAssignment(x, day, shift));

export const isAdultInRoom = (a: Adult, roomId: string | number, day: Day, shift: Shift) =>
  !!roomId &&
  Array.isArray(a.assignments) &&
  a.assignments.some((x) => checkStaffAssignment(x, day, shift, roomId));

export function isStudentPresent(s: Student, day: Day, shift: Shift): boolean {
  const arr = s.schedule?.[shift];
  return Array.isArray(arr) && arr.includes(day);
}

// Filtros de vila (idênticos ao renderRooms do v2.7): segmento "vila2" cai na
// Vila 2; sem segmento ou "vila1" cai na Vila 1.
export function roomInVila(room: Room, vila: Vila): boolean {
  const seg = sid(room.segmento);
  return vila === "vila2" ? seg === "vila2" : !seg || seg === "vila1";
}

export function adultInVila(a: Adult, vila: Vila): boolean {
  const seg = sid(a.segmento);
  return vila === "vila2" ? seg === "vila2" : !seg || seg === "vila1";
}

export const sortRooms = (rooms: Room[]) =>
  [...rooms].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" })
  );

export function translateType(staffTypes: StaffType[], typeId?: string): string {
  const t = staffTypes.find((s) => s.id === typeId);
  return t?.label || typeId || "—";
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

// Dia da semana letivo a partir de uma data ISO ("YYYY-MM-DD"). null em fim de semana.
const WEEKDAY: Record<number, Day> = { 1: "segunda", 2: "terca", 3: "quarta", 4: "quinta", 5: "sexta" };
export function weekdayFromISO(iso: string): Day | null {
  const d = new Date(`${iso}T00:00:00`);
  return WEEKDAY[d.getDay()] ?? null;
}

// Conjunto de IDs normalizados (strings), para checagens de inclusão robustas.
export function idSet(ids: (string | number)[] | undefined): Set<string> {
  return new Set((ids ?? []).map((v) => String(v).trim()));
}

// "YYYY-MM-DD" -> "DD/MM/YYYY"
export const formatBR = (iso: string) => iso.split("-").reverse().join("/");

export function isAdultAbsentToday(a: Adult, today = todayISO()): boolean {
  return Array.isArray(a.absences) && a.absences.some((abs) => abs?.date === today);
}

export function ratioBadge(ratio: number): "success" | "warning" | "danger" {
  if (ratio > 15) return "danger";
  if (ratio > 10) return "warning";
  return "success";
}
