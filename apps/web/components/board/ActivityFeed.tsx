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
    case "time_edited":
      return typeof a.payload.text === "string" ? a.payload.text : "corrigiu o tempo registrado";
    case "card_archived":
      return "arquivou o card";
    case "card_restored":
      return "reativou o card";
    case "card_transferred": {
      const from = typeof a.payload.fromBoardName === "string" ? a.payload.fromBoardName : "outro pipeline";
      const to = typeof a.payload.toBoardName === "string" ? a.payload.toBoardName : "outro pipeline";
      const old = a.payload.oldNumber != null ? ` (era #${a.payload.oldNumber})` : "";
      return `enviou o card de “${from}” para “${to}”${old}`;
    }
    case "due_date_changed": {
      const day = (v: unknown) =>
        typeof v === "string" ? new Date(`${v.slice(0, 10)}T12:00`).toLocaleDateString("pt-BR") : null;
      const to = day(a.payload.to);
      const from = day(a.payload.from);
      if (!to) return "removeu o prazo";
      return from ? `mudou o prazo de ${from} para ${to}` : `definiu o prazo para ${to}`;
    }
    case "rework_changed":
      return `corrigiu as emendas de ${a.payload.from ?? 0} para ${a.payload.to ?? 0}`;
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
            <span className="ml-1 text-xs text-neutral-600">· {timeAgo(a.createdAt)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
