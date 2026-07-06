import type { Member } from "./types";

const COLORS = [
  "bg-rose-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-primary",
];

/** Monta um Member (avatar) a partir do id + nome, com cor determinística. */
export function memberView(id: string, name: string): Member {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const label = name || "?";
  return {
    id,
    name: label,
    initials: label.slice(0, 2).toUpperCase(),
    colorClass: COLORS[h % COLORS.length]!,
  };
}
