"use client";

import clsx from "clsx";
import { Archive, Check, ChevronDown, Pencil, Plus, RotateCcw, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createBoard,
  loadBoardMembers,
  renameBoard,
  setBoardArchived,
  setBoardMember,
} from "@/lib/board/actions";
import type { BoardSummary } from "@/lib/board/types";
import { MemberManagerDialog } from "@/components/common/MemberManagerDialog";

export function PipelineSelector({
  boards,
  currentId,
  canConfigure,
}: {
  boards: BoardSummary[];
  currentId: string;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [membersFor, setMembersFor] = useState<BoardSummary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = boards.filter((b) => !b.archived);
  const archived = boards.filter((b) => b.archived);
  const current = boards.find((b) => b.id === currentId);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function go(boardId: string) {
    setOpen(false);
    router.push(`/board?board=${boardId}`);
  }

  const loadMembers = useCallback(() => loadBoardMembers(membersFor?.id ?? ""), [membersFor]);
  const toggleMember = useCallback(
    (uid: string, m: boolean) => setBoardMember(membersFor?.id ?? "", uid, m),
    [membersFor],
  );

  async function submitNew() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    const id = await createBoard(newName);
    setBusy(false);
    setCreating(false);
    setNewName("");
    go(id);
  }

  async function submitRename(id: string) {
    if (!editName.trim() || busy) return;
    setBusy(true);
    await renameBoard(id, editName);
    setBusy(false);
    setEditingId(null);
    router.refresh();
  }

  async function archive(id: string, archived: boolean) {
    setBusy(true);
    await setBoardArchived(id, archived);
    setBusy(false);
    // Se arquivou o atual, vai para outro pipeline ativo.
    if (archived && id === currentId) {
      const next = active.find((b) => b.id !== id);
      if (next) go(next.id);
      else router.refresh();
    } else {
      router.refresh();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left hover:bg-neutral-100"
      >
        <span className="text-lg font-semibold text-neutral-800">{current?.name ?? "Pipeline"}</span>
        <ChevronDown className="h-4 w-4 text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
          <div className="border-b border-neutral-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Pipelines
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {active.map((b) => (
              <li key={b.id} className="group px-1">
                {editingId === b.id ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitRename(b.id)}
                      className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm outline-none"
                    />
                    <button type="button" onClick={() => submitRename(b.id)} className="p-1 text-primary" aria-label="Salvar">
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="p-1 text-neutral-400" aria-label="Cancelar">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 rounded-md hover:bg-neutral-100">
                    <button
                      type="button"
                      onClick={() => go(b.id)}
                      className={clsx(
                        "min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm",
                        b.id === currentId ? "font-semibold text-primary" : "text-neutral-700",
                      )}
                    >
                      {b.name}
                    </button>
                    {canConfigure && (
                      <div className="flex shrink-0 pr-1 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            setMembersFor(b);
                            setOpen(false);
                          }}
                          className="p-1 text-neutral-400 hover:text-neutral-700"
                          title="Membros / acesso"
                          aria-label="Membros"
                        >
                          <Users className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(b.id);
                            setEditName(b.name);
                          }}
                          className="p-1 text-neutral-400 hover:text-neutral-700"
                          aria-label="Renomear"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => archive(b.id, true)}
                          disabled={active.length <= 1}
                          title={active.length <= 1 ? "Não é possível arquivar o único pipeline" : "Arquivar"}
                          className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
                          aria-label="Arquivar"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {canConfigure && (
            <div className="border-t border-neutral-100 p-1">
              {creating ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitNew()}
                    placeholder="Nome do pipeline"
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm outline-none"
                  />
                  <button type="button" onClick={submitNew} disabled={busy} className="p-1 text-primary" aria-label="Criar">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setCreating(false)} className="p-1 text-neutral-400" aria-label="Cancelar">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  <Plus className="h-4 w-4" /> Novo pipeline
                </button>
              )}
            </div>
          )}

          {canConfigure && archived.length > 0 && (
            <div className="border-t border-neutral-100 py-1">
              <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                Arquivados
              </p>
              {archived.map((b) => (
                <div key={b.id} className="flex items-center gap-1 px-1">
                  <span className="min-w-0 flex-1 truncate px-2 py-1 text-sm text-neutral-400">{b.name}</span>
                  <button
                    type="button"
                    onClick={() => archive(b.id, false)}
                    className="p-1 text-neutral-400 hover:text-neutral-700"
                    title="Desarquivar"
                    aria-label="Desarquivar"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {membersFor && (
        <MemberManagerDialog
          title={`Acesso: ${membersFor.name}`}
          load={loadMembers}
          onToggle={toggleMember}
          onClose={() => setMembersFor(null)}
        />
      )}
    </div>
  );
}
