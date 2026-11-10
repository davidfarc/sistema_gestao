"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import clsx from "clsx";
import { todayKey } from "@/lib/anamnese/time";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];

const navBtn =
  "grid h-10 w-10 place-items-center rounded-full border border-surface-medium bg-surface-lowest text-primary transition hover:border-primary/30 hover:bg-surface-low disabled:pointer-events-none disabled:opacity-30";

/** Calendário mensal acessível. Datas sem disponibilidade ficam desabilitadas. `month` = "yyyy-MM". */
export function MonthCalendar({
  month, onMonthChange, available, selected, onSelect, minMonth, maxMonth, loading,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  available: Set<string>;
  selected?: string | null;
  onSelect: (date: string) => void;
  minMonth: string;
  maxMonth: string;
  loading?: boolean;
}) {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayKey();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(d.toISOString().slice(0, 7));
  };
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];

  return (
    <div className="w-full max-w-md rounded-2xl border border-surface-medium bg-surface-lowest p-4 sm:p-5" aria-busy={loading}>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={month <= minMonth} aria-label="Mês anterior" className={navBtn}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="flex items-center gap-2 font-headline text-lg font-bold text-primary" aria-live="polite">
          {MONTHS[m - 1]} de {y}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-secondary" aria-hidden />}
        </p>
        <button type="button" onClick={() => shift(1)} disabled={month >= maxMonth} aria-label="Próximo mês" className={navBtn}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-secondary/70">
        {DOW.map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className={clsx("mt-1 grid grid-cols-7 gap-1.5 transition-opacity", loading && "opacity-50")}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const ok = available.has(key);
          const sel = selected === key;
          const isToday = key === today;
          return (
            <button
              key={i}
              type="button"
              disabled={!ok}
              onClick={() => onSelect(key)}
              aria-pressed={sel}
              aria-label={`${day} de ${MONTHS[m - 1]}${ok ? ", com horários disponíveis" : ", indisponível"}`}
              className={clsx(
                "relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm font-semibold transition",
                ok
                  ? "bg-primary/[0.06] text-primary hover:-translate-y-0.5 hover:bg-primary hover:text-white hover:shadow-premium-soft"
                  : "cursor-not-allowed text-secondary/35",
                isToday && !sel && "ring-1 ring-primary/40",
                sel && "!bg-primary !text-white shadow-premium-hover",
              )}
            >
              {day}
              {ok && (
                <span
                  aria-hidden
                  className={clsx("absolute bottom-1.5 h-1 w-1 rounded-full", sel ? "bg-white" : "bg-success")}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-medium pt-3 text-xs text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Com horários
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full ring-1 ring-primary/50" aria-hidden /> Hoje
        </span>
        <span className="inline-flex items-center gap-1.5 text-secondary/60">
          <span className="font-semibold">12</span> Sem horários
        </span>
      </div>
    </div>
  );
}
