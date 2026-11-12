"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Placement } from "@ecco/core";
import { useMemo, useState } from "react";

import { CardTile } from "./CardTile";
import { NewStageButton } from "./NewStageButton";
import { StageHeader } from "./StageHeader";
import type { CardView, StageView } from "@/lib/board/types";

// Largura da coluna (w-72) + espaço entre colunas (gap-3), em px.
const COLUMN_STEP = 288 + 12;

/**
 * Teclado: ↑/↓ andam pela coluna (padrão do sortable); ←/→ pulam uma coluna
 * inteira, em vez dos 25 px padrão que exigiriam uma dúzia de toques.
 */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    const dir = event.code === "ArrowRight" ? 1 : -1;
    return { ...args.currentCoordinates, x: args.currentCoordinates.x + dir * COLUMN_STEP };
  }
  return sortableKeyboardCoordinates(event, args);
};

function SortableCard({ card, onOpen }: { card: CardView; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
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
        if (e.key === "Enter" && !isDragging) {
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
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <SortableCard key={c.id} card={c} onOpen={() => onOpenCard(c.id)} />
          ))}
        </SortableContext>
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
  /** Na ordem de exibição: dentro de cada etapa vale a ordem desta lista. */
  cards: CardView[];
  onMove: (cardId: string, toStageId: string, placement: Placement) => void;
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
  onError: (message: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Cópia da lista enquanto um card está sendo arrastado: é nela que o card
  // "abre espaço" nas outras colunas. Ao soltar, o resultado vai para `onMove`.
  const [dragging, setDragging] = useState<CardView[] | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Toque: segurar 200 ms para arrastar; um toque curto abre, deslizar rola.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const shown = dragging ?? cards;
  const stageIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages]);
  const activeCard = shown.find((c) => c.id === activeId) ?? null;

  /** Etapa de um alvo de soltura: a própria coluna ou a coluna do card. */
  function stageOf(list: CardView[], id: string): string | undefined {
    return stageIds.has(id) ? id : list.find((c) => c.id === id)?.stageId;
  }

  function handleStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragging(cards);
  }

  // Passou por cima de OUTRA coluna: o card muda de coluna na cópia local, na
  // altura em que está o ponteiro. (Dentro da mesma coluna o próprio sortable
  // anima; a troca só é gravada ao soltar.)
  function handleOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const cardId = String(active.id);
    const overId = String(over.id);
    setDragging((prev) => {
      if (!prev) return prev;
      const from = stageOf(prev, cardId);
      const to = stageOf(prev, overId);
      const moving = prev.find((c) => c.id === cardId);
      if (!moving || !from || !to || from === to) return prev;
      const rest = prev.filter((c) => c.id !== cardId);
      const moved = { ...moving, stageId: to };
      const overIndex = rest.findIndex((c) => c.id === overId);
      if (overIndex < 0) return [...rest, moved]; // soltou na coluna (vazia ou no pé)
      const translated = active.rect.current.translated;
      // Compara os centros: passou do meio do card de baixo → entra depois dele.
      const below =
        !!translated &&
        translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2;
      const at = overIndex + (below ? 1 : 0);
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    });
  }

  function handleEnd(e: DragEndEvent) {
    const list = dragging;
    setActiveId(null);
    setDragging(null);
    const { active, over } = e;
    if (!over || !list) return;
    const cardId = String(active.id);
    const overId = String(over.id);
    const original = cards.find((c) => c.id === cardId);
    const toStageId = stageOf(list, cardId);
    if (!original || !toStageId) return;

    // Solto sobre outro card da mesma coluna: assume o lugar dele.
    let final = list;
    if (overId !== cardId && !stageIds.has(overId) && stageOf(list, overId) === toStageId) {
      const oldIndex = list.findIndex((c) => c.id === cardId);
      const newIndex = list.findIndex((c) => c.id === overId);
      final = arrayMove(list, oldIndex, newIndex);
    }

    const column = final.filter((c) => c.stageId === toStageId);
    const i = column.findIndex((c) => c.id === cardId);
    const placement: Placement = {
      beforeId: column[i - 1]?.id ?? null,
      afterId: column[i + 1]?.id ?? null,
    };

    // Voltou para o mesmo lugar: nada a gravar.
    if (original.stageId === toStageId) {
      const before = cards.filter((c) => c.stageId === toStageId);
      const j = before.findIndex((c) => c.id === cardId);
      if (
        (before[j - 1]?.id ?? null) === placement.beforeId &&
        (before[j + 1]?.id ?? null) === placement.afterId
      ) {
        return;
      }
    }
    onMove(cardId, toStageId, placement);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleStart}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragging(null);
      }}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage, i) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={shown.filter((c) => c.stageId === stage.id)}
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
