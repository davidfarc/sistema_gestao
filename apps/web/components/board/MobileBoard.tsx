"use client";

import { useEffect, useRef, useState } from "react";

import { CardTile } from "./CardTile";
import { AddCard } from "./KanbanBoard";
import type { CardView, StageView } from "@/lib/board/types";

/**
 * Quadro no celular: UMA etapa por vez. As etapas viram abas roláveis no topo
 * e dá para trocar deslizando para os lados. Não há arrastar: para mudar um
 * card de etapa, abre-se o card e usa-se "Mover para…".
 */
export function MobileBoard({
  stages,
  cards,
  onOpenCard,
  onAddCard,
}: {
  stages: StageView[];
  /** Na ordem de exibição (dentro de cada etapa vale a ordem desta lista). */
  cards: CardView[];
  onOpenCard: (id: string) => void;
  onAddCard?: (stageId: string, title: string) => Promise<void>;
}) {
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // A aba da etapa visível fica sempre à vista na faixa de abas.
  useEffect(() => {
    tabs.current[active]?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  function go(index: number) {
    const el = scroller.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: index * el.clientWidth, behavior: calm ? "auto" : "smooth" });
    setActive(index);
  }

  function onScroll() {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== active && index >= 0 && index < stages.length) setActive(index);
  }

  if (stages.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-neutral-600">
        Este pipeline ainda não tem etapas. Elas são criadas pelo computador.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Etapas"
        className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 px-2"
      >
        {stages.map((stage, i) => {
          const count = cards.filter((c) => c.stageId === stage.id).length;
          const selected = i === active;
          return (
            <button
              key={stage.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`etapa-aba-${stage.id}`}
              aria-selected={selected}
              aria-controls={`etapa-painel-${stage.id}`}
              onClick={() => go(i)}
              className={
                "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm " +
                (selected
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-neutral-600")
              }
            >
              {stage.name}
              <span
                className={
                  "rounded-full px-1.5 text-xs " +
                  (selected ? "bg-primary text-white" : "bg-neutral-200 text-neutral-700")
                }
              >
                {stage.wipLimit ? `${count}/${stage.wipLimit}` : count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {stages.map((stage) => {
          const column = cards.filter((c) => c.stageId === stage.id);
          return (
            <section
              key={stage.id}
              role="tabpanel"
              id={`etapa-painel-${stage.id}`}
              aria-labelledby={`etapa-aba-${stage.id}`}
              className="w-full shrink-0 snap-center overflow-y-auto bg-neutral-100/70 p-3"
            >
              {column.length === 0 && (
                <p className="px-2 py-8 text-center text-sm text-neutral-600">
                  Nenhum card nesta etapa.
                </p>
              )}
              <div className="grid gap-2">
                {column.map((card) => (
                  <div
                    key={card.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir card #${card.number}: ${card.title}`}
                    onClick={() => onOpenCard(card.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenCard(card.id);
                      }
                    }}
                    className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <CardTile card={card} />
                  </div>
                ))}
              </div>
              {onAddCard && (
                <AddCard stageName={stage.name} onAdd={(title) => onAddCard(stage.id, title)} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
