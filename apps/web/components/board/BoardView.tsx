"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { CardDetail } from "./CardDetail";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { NewCardDialog } from "./NewCardDialog";
import { moveCard } from "@/lib/board/actions";
import type { BoardData } from "@/lib/board/types";

type View = "kanban" | "list";

export function BoardView({ board }: { board: BoardData }) {
  const router = useRouter();
  const [cards, setCards] = useState(board.cards);
  const [view, setView] = useState<View>("kanban");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Sincroniza com o servidor após router.refresh() (ex.: card recém-criado).
  useEffect(() => setCards(board.cards), [board.cards]);

  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const selectedStage = selectedCard
    ? board.stages.find((s) => s.id === selectedCard.stageId)
    : undefined;

  function move(cardId: string, toStageId: string) {
    setMoveError(null);
    // Otimista: move na hora; se um gate barrar no servidor, reverte.
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, stageId: toStageId } : c)),
    );
    moveCard(cardId, toStageId).then((res) => {
      if (!res.ok) {
        setMoveError(res.reason);
        router.refresh(); // reverte para o estado real do servidor
      }
    });
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">{board.name}</h1>
          <p className="text-xs text-neutral-400">{cards.length} cards</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex rounded-lg border border-neutral-200 p-0.5 text-sm">
            <ToggleButton active={view === "kanban"} onClick={() => setView("kanban")}>
              Kanban
            </ToggleButton>
            <ToggleButton active={view === "list"} onClick={() => setView("list")}>
              Lista
            </ToggleButton>
          </div>
          <NewCardDialog />
        </div>
      </header>

      {moveError && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          <span>🚫 {moveError}</span>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            className="ml-auto text-amber-600 hover:text-amber-900"
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {view === "kanban" ? (
          <KanbanBoard
            stages={board.stages}
            cards={cards}
            onMove={move}
            onOpenCard={setSelectedCardId}
          />
        ) : (
          <ListView cards={cards} stages={board.stages} onOpenCard={setSelectedCardId} />
        )}
      </div>

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          stage={selectedStage}
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md px-3 py-1 font-medium transition-colors " +
        (active ? "bg-primary text-white" : "text-neutral-500 hover:text-neutral-800")
      }
    >
      {children}
    </button>
  );
}
