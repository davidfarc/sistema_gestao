"use client";

import { DEFAULT_THRESHOLDS, type Thresholds } from "@ecco/core";
import { createContext, useContext, type ReactNode } from "react";

import type {
  ChecklistTemplate,
  CreationForm,
  FieldDef,
  FieldValueRaw,
  Intake,
  MemberOption,
} from "@/lib/board/types";

/**
 * Dados do pipeline que a Lista e os formulários de criação usam (propriedades,
 * valores, pessoas, modelos de checklist). O quadro busca uma vez, em segundo
 * plano, e todos reaproveitam: abrir a Lista ou o "Novo card" não espera o
 * servidor.
 */
export interface BoardExtras {
  fields: FieldDef[];
  values: { cardId: string; value: FieldValueRaw }[];
  members: MemberOption[];
  prioritizedCardIds: string[];
  templates: ChecklistTemplate[];
}

interface ExtrasCtx {
  /** null = ainda carregando (ou fora do quadro). */
  data: BoardExtras | null;
  /** Busca de novo no servidor e devolve o que veio. */
  reload: () => Promise<BoardExtras | null>;
}

const NO_EXTRAS: ExtrasCtx = { data: null, reload: async () => null };
const ExtrasContext = createContext<ExtrasCtx>(NO_EXTRAS);

export function BoardExtrasProvider({ value, children }: { value: ExtrasCtx; children: ReactNode }) {
  return <ExtrasContext.Provider value={value}>{children}</ExtrasContext.Provider>;
}

/** Dados extras do pipeline; `data` é null enquanto carrega ou fora do quadro. */
export function useBoardExtras(): ExtrasCtx {
  return useContext(ExtrasContext);
}

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
