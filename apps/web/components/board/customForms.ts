"use client";

import type { ComponentType } from "react";

import { DemandasCreateForm } from "./DemandasCreateForm";

/** Props que todo formulário de criação personalizado recebe. */
export interface CustomFormProps {
  boardId: string;
  onClose: () => void;
  onCreated: (cardId: string) => void;
}

/**
 * Registro de formulários de criação PERSONALIZADOS, por chave. O modo do
 * pipeline `custom:<chave>` seleciona um destes. Para adicionar um novo:
 * criar o componente e registrá-lo aqui — o seletor de modo mostra sozinho.
 */
export const CUSTOM_FORMS: Record<
  string,
  { label: string; Component: ComponentType<CustomFormProps> }
> = {
  demandas: { label: "Demandas de compras", Component: DemandasCreateForm },
};

/** Rótulo amigável de um form personalizado (ou null se a chave não existe). */
export function customFormLabel(key: string): string | null {
  return CUSTOM_FORMS[key]?.label ?? null;
}
