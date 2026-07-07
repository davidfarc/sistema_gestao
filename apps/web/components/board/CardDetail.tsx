"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";

import { loadCardDetail, updateCard } from "@/lib/board/actions";
import type { CardDetailData, CardView, StageView } from "@/lib/board/types";
import { ActivityFeed } from "./ActivityFeed";
import { Attachments } from "./Attachments";
import { Checklists } from "./Checklists";
import { Comments } from "./Comments";
import { Responsavel } from "./Responsavel";

const EMPTY: CardDetailData = {
  checklists: [],
  attachments: [],
  activity: [],
  comments: [],
  assignments: [],
  members: [],
};

export function CardDetail({
  card,
  stage,
  onClose,
}: {
  card: CardView;
  stage: StageView | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(card.title);
  const [data, setData] = useState<CardDetailData | null>(null);

  const reload = useCallback(() => {
    loadCardDetail(card.id).then(setData);
  }, [card.id]);

  useEffect(() => {
    let active = true;
    loadCardDetail(card.id).then((d) => {
      if (active) setData(d);
    });
    return () => {
      active = false;
    };
  }, [card.id]);

  function saveTitle() {
    const next = title.trim();
    if (!next || next === card.title) return;
    startTransition(async () => {
      await updateCard({ id: card.id, title: next });
      router.refresh();
    });
  }

  const d = data ?? EMPTY;
  const reloadAndRefresh = () => {
    reload();
    router.refresh();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-neutral-200 p-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="font-medium text-neutral-500">#{card.number}</span>
              {stage && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                  {stage.name}
                </span>
              )}
              {!data && <span className="italic">carregando…</span>}
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

        <Section title="Responsável">
          <Responsavel
            cardId={card.id}
            stageId={card.stageId}
            stageName={stage?.name}
            assignments={d.assignments}
            members={d.members}
            onChanged={reloadAndRefresh}
          />
        </Section>

        <Section title="Checklists">
          <Checklists cardId={card.id} checklists={d.checklists} onChanged={reload} />
        </Section>

        <Section title="Anexos">
          <Attachments cardId={card.id} attachments={d.attachments} onChanged={reload} />
        </Section>

        <Section title="Atividade">
          <ActivityFeed activity={d.activity} />
        </Section>

        <div className="p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Comentários
          </p>
          <Comments cardId={card.id} comments={d.comments} members={d.members} onChanged={reload} />
        </div>

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-neutral-100 p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</p>
      {children}
    </div>
  );
}
