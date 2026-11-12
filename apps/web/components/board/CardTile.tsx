import { CheckSquare, Clock, ListOrdered, MessageSquare } from "lucide-react";
import Link from "next/link";

import type { CardView } from "@/lib/board/types";

function Avatar({
  initials,
  colorClass,
  name,
}: {
  initials: string;
  colorClass: string;
  name: string;
}) {
  return (
    <span
      className={
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white " +
        colorClass
      }
      title={`Responsável: ${name}`}
    >
      {initials}
    </span>
  );
}

/**
 * Situação do prazo. `due_date` é só data (AAAA-MM-DD): comparar como texto com
 * o dia local evita o deslize de fuso de `new Date("2026-11-12")` (meia-noite UTC).
 */
function dueInfo(due: string): { label: string; cls: string; hint: string } {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = due.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  const label = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
  if (day < today) return { label, cls: "bg-red-50 text-red-700", hint: "Prazo vencido" };
  if (day === today) return { label, cls: "bg-amber-50 text-amber-800", hint: "Vence hoje" };
  return { label, cls: "text-neutral-500", hint: "Prazo" };
}

/** Face do card (modelo Trello atual). Puro — sem lógica de drag. */
export function CardTile({ card }: { card: CardView }) {
  const due = card.dueDate ? dueInfo(card.dueDate) : null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium text-neutral-500">#{card.number}</div>

      <p className="mt-1 text-sm font-medium leading-snug text-neutral-800">
        {card.title}
      </p>

      {card.awaitingPrioritization && (
        // stopPropagation: o card é arrastável; sem isso o clique vira drag.
        <Link
          href="/prioridades"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="mt-2 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100"
          title="Esta demanda precisa passar pela fila de priorização"
        >
          <ListOrdered className="h-3 w-3" />
          Aguarda priorização
        </Link>
      )}

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

      {card.fields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.fields.map((f) => (
            <span
              key={f.fieldId}
              title={f.name}
              className={
                "rounded px-1.5 py-0.5 text-[10px] font-medium " +
                (f.color ? "" : "bg-neutral-100 text-neutral-600")
              }
              style={f.color ? { backgroundColor: `${f.color}22`, color: f.color } : undefined}
            >
              {f.display}
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
          {due && (
            <span
              title={due.hint}
              className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium " + due.cls}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{due.hint}: </span>
              {due.label}
            </span>
          )}
          {card.checklist && card.checklist.total > 0 && (
            <span
              title="Itens de checklist concluídos"
              className={
                "inline-flex items-center gap-1 text-[11px] " +
                (card.checklist.done === card.checklist.total ? "text-emerald-700" : "text-neutral-500")
              }
            >
              <CheckSquare className="h-3 w-3" aria-hidden="true" />
              {card.checklist.done}/{card.checklist.total}
            </span>
          )}
          {!!card.commentCount && (
            <span title="Comentários" className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              {card.commentCount}
            </span>
          )}
        </div>
        {card.assignee && (
          <Avatar
            initials={card.assignee.initials}
            colorClass={card.assignee.colorClass}
            name={card.assignee.name}
          />
        )}
      </div>
    </div>
  );
}
