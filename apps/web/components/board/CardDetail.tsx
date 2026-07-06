"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateCard } from "@/lib/board/actions";
import { ActivityFeed } from "./ActivityFeed";
import { Attachments } from "./Attachments";
import { Checklists } from "./Checklists";
import { Comments } from "./Comments";
import { FieldsSection } from "./FieldsSection";
import { Responsavel } from "./Responsavel";
import type { CardView, StageView } from "@/lib/board/types";

export function CardDetail({
  card,
  stage,
  onClose,
  canConfigure = false,
}: {
  card: CardView;
  stage: StageView | undefined;
  onClose: () => void;
  canConfigure?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(card.title);
  const [activityKey, setActivityKey] = useState(0);

  function saveTitle() {
    const next = title.trim();
    if (!next || next === card.title) return;
    startTransition(async () => {
      await updateCard({ id: card.id, title: next });
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-200 p-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="font-medium text-neutral-500">#{card.number}</span>
              {stage && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                  {stage.name}
                </span>
              )}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="mt-1 w-full text-lg font-semibold text-neutral-800 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Responsável (etapa atual) */}
        <div className="border-b border-neutral-100 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Responsável
          </p>
          <Responsavel
            cardId={card.id}
            stageId={card.stageId}
            stageName={stage?.name}
            onChange={() => {
              router.refresh();
              setActivityKey((k) => k + 1);
            }}
          />
        </div>

        {/* Propriedades customizadas */}
        <div className="border-b border-neutral-100 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Propriedades
          </p>
          <FieldsSection cardId={card.id} canConfigure={canConfigure} />
        </div>

        {/* Checklists */}
        <div className="border-b border-neutral-100 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Checklists
          </p>
          <Checklists cardId={card.id} onActivity={() => setActivityKey((k) => k + 1)} />
        </div>

        {/* Anexos */}
        <div className="border-b border-neutral-100 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Anexos
          </p>
          <Attachments cardId={card.id} />
        </div>

        {/* Atividade (feed estilo Trello) */}
        <div className="border-b border-neutral-100 p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Atividade
          </p>
          <ActivityFeed cardId={card.id} refreshKey={activityKey} />
        </div>

        {/* Comentários */}
        <div className="p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Comentários
          </p>
          <Comments cardId={card.id} />
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-neutral-200 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
