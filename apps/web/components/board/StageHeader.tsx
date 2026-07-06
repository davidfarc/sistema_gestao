"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { deleteStage, renameStage, reorderStage, setStageCategory } from "@/lib/board/actions";
import type { StageCategory } from "@/lib/board/types";

const DOT: Record<StageCategory, string> = {
  backlog: "bg-neutral-400",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};
const CATEGORIES: StageCategory[] = ["backlog", "in_progress", "review", "done"];
const CAT_LABEL: Record<StageCategory, string> = {
  backlog: "Backlog",
  in_progress: "Em andamento",
  review: "Revisão",
  done: "Concluído",
};

export function StageHeader({
  stage,
  count,
  canConfigure,
  isFirst,
  isLast,
}: {
  stage: { id: string; name: string; category: StageCategory };
  count: number;
  canConfigure: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [menuOpen, setMenuOpen] = useState(false);

  async function saveName() {
    setEditing(false);
    if (name.trim() && name.trim() !== stage.name) {
      await renameStage(stage.id, name);
      router.refresh();
    } else {
      setName(stage.name);
    }
  }
  async function cycleCategory() {
    const next = CATEGORIES[(CATEGORIES.indexOf(stage.category) + 1) % CATEGORIES.length]!;
    await setStageCategory(stage.id, next);
    router.refresh();
  }
  async function move(dir: "left" | "right") {
    setMenuOpen(false);
    await reorderStage(stage.id, dir);
    router.refresh();
  }
  async function remove() {
    setMenuOpen(false);
    try {
      await deleteStage(stage.id);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao remover.");
    }
  }

  return (
    <div className="relative mb-2 flex items-center gap-2 px-1">
      <button
        type="button"
        onClick={canConfigure ? cycleCategory : undefined}
        title={canConfigure ? "Mudar categoria" : CAT_LABEL[stage.category]}
        className={"h-2 w-2 shrink-0 rounded-full " + DOT[stage.category]}
        aria-label="Categoria"
      />

      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-1 text-sm font-semibold text-neutral-700 outline-none"
        />
      ) : (
        <h3
          onClick={() => canConfigure && setEditing(true)}
          className={
            "truncate text-sm font-semibold text-neutral-700 " +
            (canConfigure ? "cursor-text" : "")
          }
        >
          {stage.name}
        </h3>
      )}

      <span className="ml-auto shrink-0 text-xs text-neutral-400">{count}</span>

      {canConfigure && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
            aria-label="Opções da etapa"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                <MenuBtn onClick={() => move("left")} disabled={isFirst}>
                  ← Mover para a esquerda
                </MenuBtn>
                <MenuBtn onClick={() => move("right")} disabled={isLast}>
                  Mover para a direita →
                </MenuBtn>
                <MenuBtn onClick={remove}>Remover etapa</MenuBtn>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
