// Modelo de dados do RTDB `eccoprime-salas` (nó `escolasim_state`).
// Portado do app v2.7 (reference/salas/salas-live-v2.7.html). IDs são strings
// ou números no banco — comparar sempre via helpers de logic.ts.

export type Vila = "vila1" | "vila2";
export type Shift = "morning" | "afternoon";
export type Day = "segunda" | "terca" | "quarta" | "quinta" | "sexta";
export type Scenario = "real" | "simulated";

export interface Assignment {
  roomId?: string | number;
  start?: string; // "HH:MM"
  end?: string; // "HH:MM"
  days?: Day[];
}

export interface Absence {
  date?: string; // ISO "YYYY-MM-DD"
  reason?: string;
}

export interface Adult {
  id: string | number;
  name: string;
  type?: string; // id em staffTypes
  segmento?: Vila;
  assignments?: Assignment[];
  absences?: Absence[];
}

export interface StudentSchedule {
  morning?: Day[];
  afternoon?: Day[];
}

export interface Student {
  id: string | number;
  name: string;
  age?: number;
  roomId?: string | number;
  schedule?: StudentSchedule;
  lunchDays?: Day[];
  segmento?: Vila;
}

export interface Room {
  id: string | number;
  name: string;
  order?: number;
  segmento?: Vila;
}

export interface StaffType {
  id: string;
  label: string;
  short?: string;
}

// Rotina diária: nó `dailyRoutine` no escolasim_state, indexado por data ISO.
export interface DailyRoutine {
  absences?: (string | number)[];
  earlyDepartures?: (string | number)[];
  extraTime?: (string | number)[];
  studentNotes?: Record<string, string>;
  notes?: string;
}

// Busca Ativa: log de ações cumulativas por aluno (no escolasim_state).
export interface BuscaAtivaLog {
  step3?: boolean;
  step5?: boolean;
  step7?: boolean;
}

// Alerta gerado pela automação externa (nó separado `busca_ativa_alerts`).
export interface BuscaAtivaAlert {
  id: string | number;
  name: string;
  days: number;
  level: "red" | "orange" | "green";
  lastDate?: string;
}

export interface EscolaSimState {
  rooms: Room[];
  students: Student[];
  adults: Adult[];
  staffTypes: StaffType[];
  dailyRoutine: Record<string, DailyRoutine>;
  buscaAtivaLogs: Record<string, BuscaAtivaLog>;
}
