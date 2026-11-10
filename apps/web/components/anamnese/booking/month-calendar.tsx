"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];

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
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(d.toISOString().slice(0, 7));
  };
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];

  return (
    <div className="w-full max-w-md" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={month <= minMonth} aria-label="Mês anterior"
          className="grid size-11 place-items-center rounded-full border bg-surface-lowest hover:bg-surface-low disabled:opacity-30 border-surface-medium">
          <ChevronLeft className="size-5" />
        </button>
        <p className="text-lg font-bold" aria-live="polite">{MONTHS[m - 1]} de {y}</p>
        <button type="button" onClick={() => shift(1)} disabled={month >= maxMonth} aria-label="Próximo mês"
          className="grid size-11 place-items-center rounded-full border bg-surface-lowest hover:bg-surface-low disabled:opacity-30 border-surface-medium">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-secondary">
        {DOW.map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className={clsx("mt-1 grid grid-cols-7 gap-1", loading && "opacity-60")}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const ok = available.has(key);
          const sel = selected === key;
          return (
            <button
              key={i}
              type="button"
              disabled={!ok}
              onClick={() => onSelect(key)}
              aria-pressed={sel}
              aria-label={`${day} de ${MONTHS[m - 1]}${ok ? ", com horários disponíveis" : ", indisponível"}`}
              className={clsx(
                "aspect-square rounded-lg text-sm font-semibold transition-colors",
                ok ? "bg-success/10 text-success hover:bg-success hover:text-white" : "cursor-not-allowed text-secondary/40 line-through decoration-1",
                sel && "!bg-primary !text-white ring-2 ring-primary ring-offset-2",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
