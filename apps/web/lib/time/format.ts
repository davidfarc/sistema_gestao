/** "3h05" (totais) — horas e minutos. */
export function fmtHours(seconds: number): string {
  const m = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** "03:05:42" (cronômetro rodando). */
export function fmtClock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

/** Valor para <input type="datetime-local"> no fuso de quem está usando. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** De <input type="datetime-local"> (hora local) para ISO. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Horas a partir das quais um cronômetro ligado é provavelmente esquecimento. */
export const LONG_RUNNING_HOURS = 10;
