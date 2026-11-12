"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

import { CardTile } from "./CardTile";
import { NewStageButton } from "./NewStageButton";
import { StageHeader } from "./StageHeader";
import type { CardView, StageView } from "@/lib/board/types";

function DraggableCard({ card, onOpen }: { card: CardView; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      // `touch-manipulation` (e não `touch-none`): no celular o dedo sobre um
      // card continua rolando a tela; arrastar só começa ao segurar (TouchSensor).
      className={
        "cursor-grab touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing " +
        (isDragging ? "opacity-40" : "")
      }
      onClick={onOpen}
      {...listeners}
      {...attributes}
      aria-label={`Card #${card.number}: ${card.title}`}
      onKeyDown={(e) => {
        // Enter abre o card; Espaço fica com o dnd-kit (pegar/soltar pelo teclado).
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <CardTile card={card} />
    </div>
  );
}

function Column({
  stage,
  cards,
  onOpenCard,
  canConfigure,
  onError,
  isFirst,
  isLast,
}: {
  stage: StageView;
  cards: CardView[];
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
  onError: (message: string) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <StageHeader
        stage={stage}
        count={cards.length}
        canConfigure={canConfigure}
        onError={onError}
        isFirst={isFirst}
        isLast={isLast}
      />
      <div
        ref={setNodeRef}
        className={
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-2 transition-colors " +
          (isOver ? "bg-sky-50 ring-1 ring-sky-200" : "bg-neutral-100/70")
        }
      >
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} onOpen={() => onOpenCard(c.id)} />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({
  stages,
  cards,
  onMove,
  onOpenCard,
  canConfigure,
  onError,
}: {
  stages: StageView[];
  cards: CardView[];
  onMove: (cardId: string, toStageId: string) => void;
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
  onError: (message: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Toque: segurar 200 ms para arrastar; um toque curto abre, deslizar rola.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  function handleStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const cardId = String(active.id);
    const toStageId = String(over.id);
    const card = cards.find((c) => c.id === cardId);
    if (card && card.stageId !== toStageId) onMove(cardId, toStageId);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage, i) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={cards.filter((c) => c.stageId === stage.id)}
            onOpenCard={onOpenCard}
            canConfigure={canConfigure}
            onError={onError}
            isFirst={i === 0}
            isLast={i === stages.length - 1}
          />
        ))}
        {canConfigure && <NewStageButton />}
      </div>
      <DragOverlay>
        {activeCard ? (
          <div className="w-72 rotate-2">
            <CardTile card={activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
