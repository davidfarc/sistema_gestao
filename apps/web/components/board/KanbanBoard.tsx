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
import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

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

function SortableCard({ card, onOpen, locked }: { card: CardView; onOpen: () => void; locked: boolean }) {
  // `locked`: a pessoa não pode mudar este card de etapa (não é o responsável
  // nem gestora do pipeline). O card abre normalmente, mas não se arrasta.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: locked,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // `touch-manipulation` (e não `touch-none`): no celular o dedo sobre um
      // card continua rolando a tela; arrastar só começa ao segurar (TouchSensor).
      className={
        (locked ? "cursor-pointer " : "cursor-grab active:cursor-grabbing ") +
        "touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary " +
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

/** "+ Adicionar card" no pé da coluna: digita o título, Enter cria e já abre o próximo. */
export function AddCard({
  stageName,
  onAdd,
}: {
  stageName: string;
  onAdd: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await onAdd(next);
      setTitle("");
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex min-h-11 w-full items-center gap-1.5 rounded-lg px-2 text-sm text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar card
      </button>
    );
  }
  return (
    <form
      className="mt-1 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={inputRef}
        autoFocus
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => !title.trim() && !saving && setOpen(false)}
        aria-label={`Título do novo card em ${stageName}`}
        placeholder="Título do card…"
        className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base shadow-sm outline-none focus:border-neutral-500 sm:text-sm"
      />
      <div className="flex items-center gap-1">
        <button
          type="submit"
          disabled={!title.trim() || saving}
          className="min-h-9 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
        >
          {saving ? "Criando…" : "Adicionar"}
        </button>
        <button
          type="button"
          // mousedown: fecha antes do blur do campo, sem piscar.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
          aria-label="Cancelar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200/60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function Column({
  stage,
  cards,
  onOpenCard,
  canConfigure,
  onError,
  onAddCard,
  isFirst,
  isLast,
  canMoveCard,
}: {
  stage: StageView;
  cards: CardView[];
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
  onError: (message: string) => void;
  onAddCard?: (stageId: string, title: string) => Promise<void>;
  isFirst: boolean;
  isLast: boolean;
  canMoveCard: (card: CardView) => boolean;
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
            <SortableCard key={c.id} card={c} onOpen={() => onOpenCard(c.id)} locked={!canMoveCard(c)} />
          ))}
        </SortableContext>
      </div>
      {onAddCard && (
        <AddCard stageName={stage.name} onAdd={(title) => onAddCard(stage.id, title)} />
      )}
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
  onAddCard,
  canMoveCard = () => true,
}: {
  stages: StageView[];
  /** Na ordem de exibição: dentro de cada etapa vale a ordem desta lista. */
  cards: CardView[];
  onMove: (cardId: string, toStageId: string, placement: Placement) => void;
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
  onError: (message: string) => void;
  /** Presente só quando a pessoa pode criar e o pipeline usa o formulário simples. */
  onAddCard?: (stageId: string, title: string) => Promise<void>;
  /** A pessoa pode mudar este card de etapa? Sem isso, o card não se arrasta. */
  canMoveCard?: (card: CardView) => boolean;
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
      <div className="flex gap-3 overflow-x-auto pb-4 md:overflow-visible">
        {stages.map((stage, i) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={shown.filter((c) => c.stageId === stage.id)}
            onOpenCard={onOpenCard}
            canConfigure={canConfigure}
            onError={onError}
            onAddCard={onAddCard}
            isFirst={i === 0}
            isLast={i === stages.length - 1}
            canMoveCard={canMoveCard}
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
