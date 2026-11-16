"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  deleteStage,
  renameStage,
  reorderStage,
  setStageCategory,
  setStageCountsRework,
  setStageWipLimit,
} from "@/lib/board/actions";
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
  onError,
  isFirst,
  isLast,
}: {
  stage: { id: string; name: string; category: StageCategory; wipLimit?: number | null; countsRework?: boolean };
  count: number;
  canConfigure: boolean;
  onError: (message: string) => void;
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
  async function changeCategory(next: StageCategory) {
    if (next === stage.category) return;
    await setStageCategory(stage.id, next);
    router.refresh();
  }
  async function changeWip() {
    setMenuOpen(false);
    const raw = window.prompt(
      `Limite de cards em "${stage.name}" (deixe vazio para não ter limite):`,
      stage.wipLimit ? String(stage.wipLimit) : "",
    );
    if (raw === null) return;
    const n = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && (!Number.isFinite(n) || n < 1)) {
      onError("Limite inválido: informe um número a partir de 1, ou deixe vazio.");
      return;
    }
    await setStageWipLimit(stage.id, n);
    router.refresh();
  }
  async function toggleRework() {
    setMenuOpen(false);
    const res = await setStageCountsRework(stage.id, !stage.countsRework);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    router.refresh();
  }
  async function move(dir: "left" | "right") {
    setMenuOpen(false);
    await reorderStage(stage.id, dir);
    router.refresh();
  }
  async function remove() {
    setMenuOpen(false);
    if (count > 0) {
      onError(`Mova os ${count} cards de "${stage.name}" antes de remover a etapa.`);
      return;
    }
    if (!window.confirm(`Remover a etapa "${stage.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteStage(stage.id);
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao remover a etapa.");
    }
  }

  const overLimit = !!stage.wipLimit && count > stage.wipLimit;

  return (
    <div className="relative mb-2 flex items-center gap-2 px-1">
      <span
        title={CAT_LABEL[stage.category]}
        className={"h-2 w-2 shrink-0 rounded-full " + DOT[stage.category]}
        aria-hidden="true"
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

      <span
        title={overLimit ? "Acima do limite da etapa" : undefined}
        className={
          "ml-auto shrink-0 rounded px-1 text-xs " +
          (overLimit ? "bg-red-50 font-semibold text-red-700" : "text-neutral-500")
        }
      >
        {stage.wipLimit ? `${count}/${stage.wipLimit}` : count}
      </span>

      {canConfigure && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
            aria-label={`Opções da etapa ${stage.name}`}
            aria-expanded={menuOpen}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                <MenuBtn onClick={() => move("left")} disabled={isFirst}>
                  ← Mover para a esquerda
                </MenuBtn>
                <MenuBtn onClick={() => move("right")} disabled={isLast}>
                  Mover para a direita →
                </MenuBtn>
                <label className="block px-3 py-1.5 text-xs text-neutral-500">
                  Categoria
                  <select
                    value={stage.category}
                    onChange={(e) => changeCategory(e.target.value as StageCategory)}
                    className="mt-1 block w-full rounded border border-neutral-300 px-1.5 py-1 text-sm text-neutral-700"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <MenuBtn onClick={changeWip}>
                  Limite de cards{stage.wipLimit ? ` (${stage.wipLimit})` : "…"}
                </MenuBtn>
                <MenuBtn onClick={toggleRework}>
                  {stage.countsRework ? "✓ " : ""}Etapa de emenda
                  <span className="block text-xs text-neutral-500">
                    Cada card que entra aqui soma uma emenda
                  </span>
                </MenuBtn>
                <div className="my-1 border-t border-neutral-100" />
                <MenuBtn onClick={remove} danger>
                  Remover etapa
                </MenuBtn>
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
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "block w-full px-3 py-1.5 text-left hover:bg-neutral-50 disabled:opacity-40 " +
        (danger ? "text-red-700" : "text-neutral-700")
      }
    >
      {children}
    </button>
  );
}
