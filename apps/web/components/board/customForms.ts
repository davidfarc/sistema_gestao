"use client";

import type { ComponentType } from "react";

/** Props que todo formulário de criação personalizado recebe. */
export interface CustomFormProps {
  boardId: string;
  onClose: () => void;
  onCreated: (cardId: string) => void;
}

/**
 * Registro de formulários de criação PERSONALIZADOS, por chave. O modo do
 * pipeline `custom:<chave>` seleciona um destes. A Fase 2 registra aqui o
 * "Demandas de compras". Nasce vazio.
 */
export const CUSTOM_FORMS: Record<
  string,
  { label: string; Component: ComponentType<CustomFormProps> }
> = {};

/** Rótulo amigável de um form personalizado (ou null se a chave não existe). */
export function customFormLabel(key: string): string | null {
  return CUSTOM_FORMS[key]?.label ?? null;
}
