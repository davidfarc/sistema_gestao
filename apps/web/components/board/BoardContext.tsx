"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Id do pipeline atualmente aberto — para as actions de escrita do board. */
const BoardIdContext = createContext<string | null>(null);

export function BoardProvider({ boardId, children }: { boardId: string; children: ReactNode }) {
  return <BoardIdContext.Provider value={boardId}>{children}</BoardIdContext.Provider>;
}

export function useBoardId(): string {
  const id = useContext(BoardIdContext);
  if (!id) throw new Error("useBoardId fora de um BoardProvider.");
  return id;
}
