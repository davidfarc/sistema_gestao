"use client";

import { DEFAULT_THRESHOLDS, type Thresholds } from "@ecco/core";
import { createContext, useContext, type ReactNode } from "react";

import type { CreationForm, Intake } from "@/lib/board/types";

interface BoardCtx {
  boardId: string;
  creationForm: CreationForm;
  thresholds: Thresholds;
  /** Id do usuário logado — para saber se ele tem alçada em cada propriedade. */
  myUserId: string | null;
  /** Quem pode abrir o formulário de criação deste pipeline. */
  intake: Intake;
}

const BoardIdContext = createContext<BoardCtx | null>(null);

export function BoardProvider({
  boardId,
  creationForm,
  thresholds,
  myUserId = null,
  intake = "members",
  children,
}: {
  boardId: string;
  creationForm: CreationForm;
  thresholds: Thresholds;
  myUserId?: string | null;
  intake?: Intake;
  children: ReactNode;
}) {
  return (
    <BoardIdContext.Provider value={{ boardId, creationForm, thresholds, myUserId, intake }}>
      {children}
    </BoardIdContext.Provider>
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

/** Limites de alçada configurados para o pipeline atual (prévia no client). */
export function useThresholds(): Thresholds {
  return useContext(BoardIdContext)?.thresholds ?? DEFAULT_THRESHOLDS;
}

/** Quem pode abrir o formulário de criação do pipeline atual. */
export function useIntake(): Intake {
  return useContext(BoardIdContext)?.intake ?? "members";
}

/** Id do usuário logado (null fora do provider). */
export function useMyUserId(): string | null {
  return useContext(BoardIdContext)?.myUserId ?? null;
}
