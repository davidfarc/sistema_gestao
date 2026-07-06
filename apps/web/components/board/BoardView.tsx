"use client";

import { useState, type ReactNode } from "react";

import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import type { BoardData } from "@/lib/board/types";

type View = "kanban" | "list";

export function BoardView({ board }: { board: BoardData }) {
  const [cards, setCards] = useState(board.cards);
  const [view, setView] = useState<View>("kanban");

  function move(cardId: string, toStageId: string) {
    // TODO: persistir via CardService.move (avalia gates no servidor).
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, stageId: toStageId } : c)),
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-neutral-200 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">{board.name}</h1>
          <p className="text-xs text-neutral-400">
            {cards.length} cards · dados de demonstração
          </p>
        </div>

        <div className="ml-auto flex rounded-lg border border-neutral-200 p-0.5 text-sm">
          <ToggleButton active={view === "kanban"} onClick={() => setView("kanban")}>
            Kanban
          </ToggleButton>
          <ToggleButton active={view === "list"} onClick={() => setView("list")}>
            Lista
          </ToggleButton>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {view === "kanban" ? (
          <KanbanBoard stages={board.stages} cards={cards} onMove={move} />
        ) : (
          <ListView cards={cards} stages={board.stages} />
        )}
      </div>
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
        (active ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-800")
      }
    >
      {children}
    </button>
  );
}
