"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { CreationForm } from "@/lib/board/types";

interface BoardCtx {
  boardId: string;
  creationForm: CreationForm;
}

const BoardIdContext = createContext<BoardCtx | null>(null);

export function BoardProvider({
  boardId,
  creationForm,
  children,
}: {
  boardId: string;
  creationForm: CreationForm;
  children: ReactNode;
}) {
  return (
    <BoardIdContext.Provider value={{ boardId, creationForm }}>{children}</BoardIdContext.Provider>
  );
}

function useBoard(): BoardCtx {
  const ctx = useContext(BoardIdContext);
  if (!ctx) throw new Error("useBoard fora de um BoardProvider.");
  return ctx;
}

/** Id do pipeline atualmente aberto — para as actions de escrita do board. */
export function useBoardId(): string {
  return useBoard().boardId;
}

/** Modo do formulário de criação do pipeline atual. */
export function useCreationForm(): CreationForm {
  return useBoard().creationForm;
}
