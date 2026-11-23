// Lógica pura portada do app v2.7 (classe EscolaSim). Sem efeitos colaterais —
// só cálculo de presença, vila e ratios, para reuso em componentes e testes.

import type { Adult, Assignment, Day, Leave, Room, Shift, StaffType, Student, Vila } from "./types";

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

/** Afastamento em vigor hoje (licença, férias…), ou null. */
export function adultLeave(a: Adult, today = new Date().toISOString().slice(0, 10)): Leave | null {
  const l = a.leave;
  if (!l || !l.from || l.from > today) return null;
  // `until` é o dia do retorno: nesse dia a pessoa já está de volta.
  if (l.until && l.until <= today) return null;
  return l;
}
export const isAdultOnLeave = (a: Adult) => adultLeave(a) !== null;

// Quem está afastado não conta como presente no turno (nem vai para o Pátio):
// continua aparecendo na sala dele, marcado como afastado.
export const isAdultPresent = (a: Adult, day: Day, shift: Shift) =>
  !isAdultOnLeave(a) &&
  Array.isArray(a.assignments) &&
  a.assignments.some((x) => checkStaffAssignment(x, day, shift));

export const isAdultInRoom = (a: Adult, roomId: string | number, day: Day, shift: Shift) =>
  !!roomId &&
  Array.isArray(a.assignments) &&
  a.assignments.some((x) => checkStaffAssignment(x, day, shift, roomId));

/** Aluno que conta: não foi marcado como fora da turma. */
export const isActiveStudent = (s: Student): boolean => s.left !== true;

export function isStudentPresent(s: Student, day: Day, shift: Shift): boolean {
  // Quem saiu da turma (transferido, cancelado) não entra em contagem nenhuma.
  if (!isActiveStudent(s)) return false;
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

/** Nome sem acento e em minúsculas, para reconhecer o tipo da sala pelo nome. */
const plainName = (room: Room) =>
  (room.name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Sala da educação básica? As salas de Colônia e de Oficina (Ballet, Basquete,
 * Futsal…) existem no cadastro, mas ficam fora do painel de Atualização de
 * salas. O tipo vem do começo do nome ("Colônia - Kids", "Oficina Ballet").
 */
export function isBasicEducationRoom(room: Room): boolean {
  // Também sem o prefixo, caso a sala se chame só "Ballet", "Basquete" ou "Futsal".
  return !/^(colonia|oficina|ballet|basquete|futsal)\b/.test(plainName(room));
}

/**
 * Ordem dos grupos no painel: Little Kids, Kids, Junior; o resto por último.
 * Aceita o nome por extenso ("Kids A", "Junior 1A") e a sigla da turma
 * ("LK1A", "K1A", "J1A"): K1A é uma turma de Kids, então vem antes de Junior.
 */
function roomGroupRank(room: Room): number {
  const name = plainName(room);
  if (/\blittle\s*kids\b|^lk\s*\d/.test(name)) return 0;
  if (/\bkids\b|^k\s*\d/.test(name)) return 1;
  if (/\bjunior\b|^jr?\.?\s*\d/.test(name)) return 2;
  return 3;
}

/** Salas do painel: só educação básica, por grupo e, dentro do grupo, por nome. */
export const panelRooms = (rooms: Room[]) =>
  sortRooms(rooms.filter(isBasicEducationRoom)).sort((a, b) => roomGroupRank(a) - roomGroupRank(b));

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
  if (adultLeave(a, today)) return true;
  return Array.isArray(a.absences) && a.absences.some((abs) => abs?.date === today);
}

/** Todos os afastamentos da pessoa (o atual e os encerrados), do mais recente ao mais antigo. */
export function allLeaves(a: Adult): Leave[] {
  const list = [...(a.leave ? [a.leave] : []), ...toArray<Leave>(a.leaveHistory)];
  return list.filter((l) => l?.from).sort((x, y) => y.from.localeCompare(x.from));
}

/**
 * Dias úteis (segunda a sexta) de um afastamento dentro do período [start, end].
 * O dia do retorno não conta; afastamento sem retorno vai até o fim do período.
 */
export function leaveWeekdaysIn(l: Leave, start: string, end: string): number {
  const from = l.from > start ? l.from : start;
  const lastDay = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const to = l.until && lastDay(l.until) < end ? lastDay(l.until) : end;
  if (from > to) return 0;
  let n = 0;
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) n++;
  }
  return n;
}

/** Texto curto da ausência de hoje: o afastamento, se houver, ou "Ausente". */
export function absenceLabel(a: Adult, today = todayISO()): string {
  const l = adultLeave(a, today);
  if (!l) return "Ausente";
  return l.until ? `${l.reason}, volta em ${formatBR(l.until).slice(0, 5)}` : l.reason;
}

export function ratioBadge(ratio: number): "success" | "warning" | "danger" {
  if (ratio > 15) return "danger";
  if (ratio > 10) return "warning";
  return "success";
}
