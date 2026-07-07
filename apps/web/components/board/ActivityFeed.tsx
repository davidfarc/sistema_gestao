"use client";

import type { ActivityView } from "@/lib/board/types";

function describe(a: ActivityView): string {
  const text = typeof a.payload.text === "string" ? `"${a.payload.text}"` : "";
  switch (a.kind) {
    case "checklist_checked":
      return `marcou ${text}`;
    case "checklist_unchecked":
      return `desmarcou ${text}`;
    case "card_moved":
      return "moveu o card de etapa";
    case "card_created":
      return "criou o card";
    case "assignment_changed":
      return "mudou o responsável";
    default:
      return a.kind;
  }
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function ActivityFeed({ activity }: { activity: ActivityView[] }) {
  if (activity.length === 0)
    return <p className="text-sm text-secondary">Nenhuma atividade ainda.</p>;

  return (
    <ul className="grid gap-2">
      {activity.map((a) => (
        <li key={a.id} className="flex items-start gap-2 text-sm">
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white"
            title={a.actorName}
          >
            {a.actorName.slice(0, 2).toUpperCase()}
          </span>
          <p className="leading-snug text-neutral-700">
            <span className="font-semibold">{a.actorName}</span> {describe(a)}
            <span className="ml-1 text-xs text-neutral-400">· {timeAgo(a.createdAt)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
