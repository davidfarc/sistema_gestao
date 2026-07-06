"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  addChecklist,
  addChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  loadChecklists,
  setChecklistItemDone,
} from "@/lib/board/actions";
import type { ChecklistView } from "@/lib/board/types";

export function Checklists({
  cardId,
  onActivity,
}: {
  cardId: string;
  onActivity?: () => void;
}) {
  const [lists, setLists] = useState<ChecklistView[]>([]);
  const [loading, setLoading] = useState(true);
  const [newList, setNewList] = useState("");

  const reload = () => loadChecklists(cardId).then(setLists);

  useEffect(() => {
    let active = true;
    loadChecklists(cardId).then((l) => {
      if (active) {
        setLists(l);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [cardId]);

  async function toggle(itemId: string, done: boolean) {
    setLists((prev) =>
      prev.map((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === itemId ? { ...i, done } : i)),
      })),
    );
    await setChecklistItemDone(itemId, done);
    onActivity?.();
  }

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!newList.trim()) return;
    await addChecklist(cardId, newList);
    setNewList("");
    await reload();
  }

  if (loading) return <p className="text-sm text-neutral-400">Carregando checklists…</p>;

  return (
    <div className="grid gap-4">
      {lists.map((list) => {
        const total = list.items.length;
        const done = list.items.filter((i) => i.done).length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return (
          <div key={list.id}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-700">{list.name}</span>
              <span className="text-xs text-neutral-400">
                {done}/{total}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await deleteChecklist(list.id);
                  await reload();
                }}
                className="ml-auto text-xs text-neutral-400 hover:text-red-600"
              >
                remover
              </button>
            </div>

            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-100">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>

            <ul className="mt-2 grid gap-1">
              {list.items.map((item) => (
                <li key={item.id} className="group flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  <span
                    className={
                      "flex-1 text-sm " +
                      (item.done ? "text-neutral-400 line-through" : "text-neutral-700")
                    }
                  >
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteChecklistItem(item.id);
                      await reload();
                    }}
                    className="text-xs text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
                    aria-label="Remover item"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <AddItem checklistId={list.id} onAdded={reload} />
          </div>
        );
      })}

      <form onSubmit={createList} className="flex gap-2">
        <input
          value={newList}
          onChange={(e) => setNewList(e.target.value)}
          placeholder="Nova checklist (ex.: Revisão)"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Adicionar
        </button>
      </form>
    </div>
  );
}

function AddItem({ checklistId, onAdded }: { checklistId: string; onAdded: () => void }) {
  const [text, setText] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await addChecklistItem(checklistId, text);
    setText("");
    onAdded();
  }

  return (
    <form onSubmit={submit} className="mt-1.5 flex gap-2 pl-6">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Adicionar item…"
        className="flex-1 rounded border border-transparent px-1 py-0.5 text-sm text-neutral-700 outline-none hover:border-neutral-200 focus:border-neutral-300"
      />
    </form>
  );
}
