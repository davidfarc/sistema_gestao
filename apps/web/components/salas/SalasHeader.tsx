"use client";

import clsx from "clsx";
import { Users, UserCheck, Clock, Gauge, Sun, Moon, RotateCcw, FlaskConical, Database } from "lucide-react";
import { useSalasControls } from "@/lib/salas/SalasContext";
import { DAYS, DAY_LABELS } from "@/lib/salas/logic";
import type { Day, Vila } from "@/lib/salas/types";

interface Stats {
  students: number;
  totalAdults: number;
  onShift: number;
  ratio: string;
}

const vilas: { id: Vila; label: string }[] = [
  { id: "vila1", label: "Vila 1" },
  { id: "vila2", label: "Vila 2" },
];

function StatCard({
  Icon,
  label,
  value,
  primary = false,
}: {
  Icon: typeof Users;
  label: string;
  value: string | number;
  primary?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl p-4 border shadow-premium-soft flex flex-col gap-1",
        primary ? "bg-primary border-transparent" : "bg-surface-lowest border-black/5"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={clsx("w-4 h-4", primary ? "text-white/70" : "text-secondary")} aria-hidden="true" />
        <span
          className={clsx(
            "text-[11px] font-semibold uppercase tracking-wide",
            primary ? "text-white/70" : "text-secondary"
          )}
        >
          {label}
        </span>
      </div>
      <span className={clsx("text-2xl font-headline font-bold", primary ? "text-white" : "text-primary")}>
        {value}
      </span>
    </div>
  );
}

export default function SalasHeader({ stats }: { stats: Stats }) {
  const { vila, day, shift, scenario, setVila, setDay, setShift, setScenario, resetSim } = useSalasControls();
  const sim = scenario === "simulated";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-headline font-bold text-primary">Gestão de Vila</h2>
          <p className="text-sm text-secondary mt-0.5">
            <span
              className={clsx(
                "inline-block px-2 py-0.5 rounded-md text-xs font-bold",
                sim ? "bg-warning/15 text-warning" : "bg-success/10 text-success"
              )}
            >
              {sim ? "Cenário Simulado" : "Cenário Real"}
            </span>{" "}
            <span className="ml-1">{DAY_LABELS[day]}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value as Day)}
            aria-label="Dia da semana"
            className="bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-1.5 text-sm font-semibold cursor-pointer"
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </select>

          <div className="flex bg-surface-lowest border border-surface-medium rounded-lg p-0.5">
            <button
              onClick={() => setShift("morning")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors",
                shift === "morning" ? "bg-primary text-white" : "text-secondary hover:text-primary"
              )}
            >
              <Sun className="w-3.5 h-3.5" aria-hidden="true" /> Manhã
            </button>
            <button
              onClick={() => setShift("afternoon")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors",
                shift === "afternoon" ? "bg-primary text-white" : "text-secondary hover:text-primary"
              )}
            >
              <Moon className="w-3.5 h-3.5" aria-hidden="true" /> Tarde
            </button>
          </div>

          <div className="flex bg-surface-lowest border border-surface-medium rounded-lg p-0.5">
            <button
              onClick={() => setScenario("real")}
              title="Cenário Real (grava no banco)"
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors",
                !sim ? "bg-primary text-white" : "text-secondary hover:text-primary"
              )}
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" /> Real
            </button>
            <button
              onClick={() => setScenario("simulated")}
              title="Cenário Simulado (edições ficam locais, não gravam)"
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors",
                sim ? "bg-warning text-white" : "text-secondary hover:text-primary"
              )}
            >
              <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" /> Simulado
            </button>
          </div>

          {sim && (
            <button
              onClick={resetSim}
              title="Recopiar o Real para o Simulado (descarta as alterações do 'e se…')"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-warning bg-warning/10 border border-warning/30 hover:bg-warning/20 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Resetar
            </button>
          )}
        </div>
      </div>

      {sim && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 text-xs text-warning">
          Você está em <strong>Cenário Simulado</strong>. Todas as alterações ficam apenas na sua tela — <strong>não gravam no banco</strong>. Use "Resetar" para voltar aos dados reais atuais.
        </div>
      )}

      {/* Abas de vila */}
      <div className="flex gap-2 border-b border-surface-medium">
        {vilas.map((v) => (
          <button
            key={v.id}
            onClick={() => setVila(v.id)}
            className={clsx(
              "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
              vila === v.id
                ? "border-primary text-primary"
                : "border-transparent text-secondary hover:text-primary"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard Icon={Users} label="Alunos" value={stats.students} />
        <StatCard Icon={UserCheck} label="Equipe Total" value={stats.totalAdults} />
        <StatCard Icon={Clock} label="Disponíveis" value={stats.onShift} />
        <StatCard Icon={Gauge} label="Média Alunos/Adulto" value={stats.ratio} primary />
      </div>
    </div>
  );
}
