"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { loadSalasState, salasWrite } from "@/lib/salas/actions";
import { toArray } from "@/lib/salas/logic";
import type {
  Adult,
  BuscaAtivaLog,
  DailyRoutine,
  Day,
  EscolaSimState,
  Room,
  Scenario,
  Shift,
  StaffType,
  Student,
  Vila,
} from "@/lib/salas/types";

// Contexto central do módulo Vila.
//
//  - Real     → estado vem do Supabase; escritas gravam no banco E no estado
//               local (otimista), para a tela reagir na hora.
//  - Simulado → snapshot LOCAL clonado do Real na primeira troca. Escritas só
//               aplicam no snapshot; nada vai para o banco. Serve para testar
//               remanejamentos ("e se…") sem afetar o real.

interface SalasCtx {
  vila: Vila;
  day: Day;
  shift: Shift;
  scenario: Scenario;
  setVila: (v: Vila) => void;
  setDay: (d: Day) => void;
  setShift: (s: Shift) => void;
  setScenario: (s: Scenario) => void;
  resetSim: () => void;

  data: EscolaSimState | null;
  loading: boolean;
  error: string | null;

  /** Pode gravar no Real? Sem isso, o módulo é consulta + Simulado. */
  canEdit: boolean;
  write: (path: string, value: unknown) => Promise<void>;
}

const SalasContext = createContext<SalasCtx | null>(null);

/**
 * Aplica um patch imutável seguindo o caminho "a/b/c".
 * `value` nulo remove a chave — mesma semântica da gravação no servidor.
 */
function setByPath<T>(obj: T, path: string, value: unknown): T {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return (value ?? null) as T;

  const [head, ...rest] = parts;
  const source =
    obj && typeof obj === "object"
      ? Array.isArray(obj)
        ? [...(obj as unknown as unknown[])]
        : { ...(obj as Record<string, unknown>) }
      : {};

  if (rest.length === 0) {
    if (value === null || value === undefined) {
      if (Array.isArray(source)) source.splice(Number(head), 1);
      else delete (source as Record<string, unknown>)[head!];
    } else {
      (source as Record<string, unknown>)[head!] = value;
    }
    return source as T;
  }
  const child = (source as Record<string, unknown>)[head!] ?? {};
  (source as Record<string, unknown>)[head!] = setByPath(child, rest.join("/"), value);
  return source as T;
}

/** Normaliza o documento salvo para o shape usado pelos componentes. */
function normalize(raw: Record<string, unknown> | null): EscolaSimState {
  const src = raw ?? {};
  return {
    rooms: toArray<Room>(src.rooms),
    students: toArray<Student>(src.students),
    adults: toArray<Adult>(src.adults),
    staffTypes: toArray<StaffType>(src.staffTypes),
    dailyRoutine: (src.dailyRoutine as Record<string, DailyRoutine>) ?? {},
    buscaAtivaLogs: (src.buscaAtivaLogs as Record<string, BuscaAtivaLog>) ?? {},
  };
}

export function SalasProvider({
  children,
  canEdit = false,
}: {
  children: ReactNode;
  canEdit?: boolean;
}) {
  const [vila, setVila] = useState<Vila>("vila1");
  const [day, setDay] = useState<Day>("segunda");
  const [shift, setShift] = useState<Shift>("morning");
  const [scenario, setScenarioState] = useState<Scenario>("real");

  const [real, setReal] = useState<EscolaSimState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EscolaSimState | null>(null);

  useEffect(() => {
    let active = true;
    loadSalasState()
      .then((raw) => {
        if (!active) return;
        setReal(normalize(raw));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Falha ao carregar.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setScenario = useCallback(
    (s: Scenario) => {
      setScenarioState(s);
      // Entrar em Simulado clona do Real na primeira vez; reentradas preservam
      // o snapshot (o "e se…" que a pessoa montou).
      if (s === "simulated" && !snapshot && real) {
        setSnapshot(structuredClone(real));
      }
    },
    [snapshot, real],
  );

  const resetSim = useCallback(() => {
    if (real) setSnapshot(structuredClone(real));
  }, [real]);

  const write = useCallback(
    async (path: string, value: unknown) => {
      if (scenario === "simulated") {
        setSnapshot((prev) => {
          const base = prev ?? (real ? structuredClone(real) : normalize(null));
          return setByPath(base, path, value);
        });
        return;
      }
      // Sem permissão de edição, não aplica nem local: aplicar e depois reverter
      // faria a tela piscar o valor novo, sugerindo que salvou.
      if (!canEdit) {
        setError("Você não tem permissão para editar a Gestão de Vila. Use o modo Simulado.");
        return;
      }
      // Real: aplica local (a tela reage na hora) e persiste.
      setReal((prev) => (prev ? setByPath(prev, path, value) : prev));
      const res = await salasWrite(path, value);
      if (!res.ok) setError(res.error);
    },
    [scenario, real, canEdit],
  );

  const data = scenario === "simulated" ? (snapshot ?? real) : real;

  const value: SalasCtx = useMemo(
    () => ({
      vila,
      day,
      shift,
      scenario,
      setVila,
      setDay,
      setShift,
      setScenario,
      resetSim,
      data,
      loading,
      error,
      canEdit,
      write,
    }),
    [vila, day, shift, scenario, data, loading, error, canEdit, setScenario, resetSim, write],
  );

  return <SalasContext.Provider value={value}>{children}</SalasContext.Provider>;
}

export function useSalasControls() {
  const ctx = useContext(SalasContext);
  if (!ctx) throw new Error("useSalasControls deve ser usado dentro de <SalasProvider>");
  const { vila, day, shift, scenario, setVila, setDay, setShift, setScenario, resetSim } = ctx;
  return { vila, day, shift, scenario, setVila, setDay, setShift, setScenario, resetSim };
}

export function useSalasScope() {
  const ctx = useContext(SalasContext);
  if (!ctx) throw new Error("useSalasScope deve ser usado dentro de <SalasProvider>");
  return {
    data: ctx.data,
    loading: ctx.loading,
    error: ctx.error,
    scenario: ctx.scenario,
    canEdit: ctx.canEdit,
  };
}

/** Pode gravar no Real? Para desabilitar controles em vez de deixar falhar. */
export function useSalasCanEdit(): boolean {
  return useContext(SalasContext)?.canEdit ?? false;
}

export function useSalasWrite() {
  const ctx = useContext(SalasContext);
  if (!ctx) throw new Error("useSalasWrite deve ser usado dentro de <SalasProvider>");
  return ctx.write;
}

/** Alias histórico de `useSalasScope` — as telas do módulo o utilizam. */
export const useSalasData = useSalasScope;
