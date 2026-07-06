"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import type { CardView, StageCategory, StageView } from "@/lib/board/types";

const CATEGORY_DOT: Record<StageCategory, string> = {
  backlog: "bg-neutral-400",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

function DraggableCard({ card }: { card: CardView }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={"cursor-grab touch-none active:cursor-grabbing " + (isDragging ? "opacity-40" : "")}
      {...listeners}
      {...attributes}
    >
      <CardTile card={card} />
    </div>
  );
}

function Column({ stage, cards }: { stage: StageView; cards: CardView[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={"h-2 w-2 rounded-full " + CATEGORY_DOT[stage.category]} />
        <h3 className="text-sm font-semibold text-neutral-700">{stage.name}</h3>
        <span className="ml-auto text-xs text-neutral-400">{cards.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-2 transition-colors " +
          (isOver ? "bg-sky-50 ring-1 ring-sky-200" : "bg-neutral-100/70")
        }
      >
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({
  stages,
  cards,
  onMove,
}: {
  stages: StageView[];
  cards: CardView[];
  onMove: (cardId: string, toStageId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
        {stages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={cards.filter((c) => c.stageId === stage.id)}
          />
        ))}
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
