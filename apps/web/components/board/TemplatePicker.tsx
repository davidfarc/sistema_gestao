"use client";

import { useEffect, useState } from "react";

import { loadChecklistTemplates } from "@/lib/board/checklistTemplates";
import type { ChecklistTemplate } from "@/lib/board/types";
import { useBoardExtras } from "./BoardContext";

/**
 * Escolha opcional de modelos de checklist no formulário de criação: o card
 * nasce com os checklists marcados. Não aparece se o pipeline não tem modelos
 * (ou se a pessoa não enxerga o pipeline, como na caixa de entrada aberta).
 */
export function TemplatePicker({
  boardId,
  value,
  onChange,
  className = "",
}: {
  boardId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  // Dentro do quadro os modelos já vieram com os dados do pipeline.
  const extras = useBoardExtras();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>(extras.data?.templates ?? []);

  useEffect(() => {
    if (extras.data) return;
    let active = true;
    loadChecklistTemplates(boardId)
      .then((r) => active && setTemplates(r.templates))
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  if (templates.length === 0) return null;

  return (
    <fieldset className={"grid gap-1.5 " + className}>
      <legend className="mb-1 text-xs font-medium text-neutral-600">Checklists (opcional)</legend>
      {templates.map((t) => (
        <label key={t.id} className="flex min-h-9 cursor-pointer items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={value.includes(t.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((id) => id !== t.id))}
            className="mt-1 h-4 w-4"
          />
          <span className="min-w-0 break-words">
            {t.name}{" "}
            <span className="text-xs text-neutral-500">
              ({t.items.length} {t.items.length === 1 ? "item" : "itens"})
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
