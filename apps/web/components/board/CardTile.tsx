import type { CardView } from "@/lib/board/types";

function Avatar({ initials, colorClass }: { initials: string; colorClass: string }) {
  return (
    <span
      className={
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white " +
        colorClass
      }
      title={initials}
    >
      {initials}
    </span>
  );
}

/** Face do card (modelo Trello atual). Puro — sem lógica de drag. */
export function CardTile({ card }: { card: CardView }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span className="font-medium text-neutral-500">#{card.number}</span>
        {card.code && <span className="truncate font-mono">{card.code}</span>}
      </div>

      <p className="mt-1 text-sm font-medium leading-snug text-neutral-800">
        {card.title}
      </p>

      {card.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.text}
              className={"rounded px-1.5 py-0.5 text-[10px] font-medium " + l.colorClass}
            >
              {l.text}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {card.status && (
            <span
              className={
                "rounded px-1.5 py-0.5 text-[10px] font-medium " + card.status.colorClass
              }
            >
              {card.status.label}
            </span>
          )}
          {card.dueDate && (
            <span className="text-[11px] text-neutral-400">
              {new Date(card.dueDate).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}
            </span>
          )}
        </div>
        {card.assignee && (
          <Avatar initials={card.assignee.initials} colorClass={card.assignee.colorClass} />
        )}
      </div>
    </div>
  );
}
