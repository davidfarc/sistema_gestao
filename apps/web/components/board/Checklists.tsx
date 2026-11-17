"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  addChecklist,
  addChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  setChecklistItemDone,
} from "@/lib/board/actions";
import {
  applyChecklistTemplate,
  deleteChecklistTemplate,
  loadChecklistTemplates,
  saveChecklistAsTemplate,
  updateChecklistTemplate,
} from "@/lib/board/checklistTemplates";
import type { ChecklistTemplate, ChecklistView } from "@/lib/board/types";

export function Checklists({
  cardId,
  boardId,
  checklists,
  onChanged,
}: {
  cardId: string;
  /** Pipeline do card: os modelos de checklist são por pipeline. */
  boardId: string;
  checklists: ChecklistView[];
  onChanged: () => void;
}) {
  const [lists, setLists] = useState(checklists);
  const [newList, setNewList] = useState("");
  // Modelos do pipeline (some tudo se a migration 0045 ainda não foi aplicada).
  const [tpl, setTpl] = useState<{ templates: ChecklistTemplate[]; available: boolean; canManage: boolean }>({
    templates: [],
    available: false,
    canManage: false,
  });
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function reloadTemplates() {
    loadChecklistTemplates(boardId)
      .then(setTpl)
      .catch(() => {});
  }
  useEffect(reloadTemplates, [boardId]);

  async function pickTemplate(templateId: string) {
    if (!templateId) return;
    setNotice(null);
    const res = await applyChecklistTemplate(cardId, templateId).catch(() => null);
    if (!res || !res.ok) setNotice({ ok: false, text: res ? res.error : "Não foi possível usar o modelo." });
    onChanged();
  }

  async function saveAsTemplate(checklistId: string, name: string) {
    setNotice(null);
    const res = await saveChecklistAsTemplate(checklistId).catch(() => null);
    if (res?.ok) {
      setNotice({ ok: true, text: `“${name}” foi salvo como modelo deste pipeline.` });
      reloadTemplates();
    } else setNotice({ ok: false, text: res ? res.error : "Não foi possível salvar o modelo." });
  }

  useEffect(() => setLists(checklists), [checklists]); // sincroniza com o reload do pai

  async function toggle(itemId: string, done: boolean) {
    setLists((prev) =>
      prev.map((l) => ({ ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, done } : i)) })),
    );
    await setChecklistItemDone(itemId, done);
    onChanged();
  }

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!newList.trim()) return;
    await addChecklist(cardId, newList);
    setNewList("");
    onChanged();
  }

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
              <span className="text-xs text-neutral-600">
                {done}/{total}
              </span>
              {tpl.available && tpl.canManage && (
                <button
                  type="button"
                  onClick={() => saveAsTemplate(list.id, list.name)}
                  className="ml-auto text-xs text-primary hover:underline"
                >
                  salvar como modelo
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await deleteChecklist(list.id);
                  onChanged();
                }}
                className={(tpl.available && tpl.canManage ? "" : "ml-auto ") + "text-xs text-neutral-600 hover:text-red-600"}
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
                      (item.done ? "text-neutral-600 line-through" : "text-neutral-700")
                    }
                  >
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteChecklistItem(item.id);
                      onChanged();
                    }}
                    className="-m-2 p-2 text-sm text-neutral-500 hover:text-red-600 md:text-xs md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    aria-label="Remover item"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <AddItem checklistId={list.id} onAdded={onChanged} />
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

      {tpl.available && (tpl.templates.length > 0 || tpl.canManage) && (
        <div className="flex flex-wrap items-center gap-2">
          {tpl.templates.length > 0 && (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-neutral-700">
              <span className="shrink-0">Usar modelo</span>
              <select
                value=""
                onChange={(e) => pickTemplate(e.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 text-sm"
              >
                <option value="">Escolha um checklist pronto…</option>
                {tpl.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.items.length} {t.items.length === 1 ? "item" : "itens"})
                  </option>
                ))}
              </select>
            </label>
          )}
          {tpl.canManage && tpl.templates.length > 0 && (
            <button
              type="button"
              onClick={() => setManaging(true)}
              className="min-h-9 rounded-lg px-2 text-sm font-medium text-primary hover:underline"
            >
              Gerenciar modelos
            </button>
          )}
          {tpl.canManage && tpl.templates.length === 0 && (
            <p className="text-xs text-neutral-600">
              Para reaproveitar um checklist, monte-o aqui e clique em “salvar como modelo”.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={"text-sm " + (notice.ok ? "text-emerald-700" : "text-red-700")}>
          {notice.text}
        </p>
      )}

      {managing && (
        <TemplatesDialog
          templates={tpl.templates}
          onClose={() => setManaging(false)}
          onChanged={reloadTemplates}
        />
      )}
    </div>
  );
}

/** Gestão dos modelos do pipeline: renomear, editar os itens (um por linha) e excluir. */
function TemplatesDialog({
  templates,
  onClose,
  onChanged,
}: {
  templates: ChecklistTemplate[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(t: ChecklistTemplate) {
    setEditing(t);
    setName(t.name);
    setText(t.items.join("\n"));
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const res = await updateChecklistTemplate(editing.id, name, text.split("\n")).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setEditing(null);
      onChanged();
    } else setError(res ? res.error : "Não foi possível salvar. Tente de novo.");
  }

  async function remove(t: ChecklistTemplate) {
    if (!window.confirm(`Excluir o modelo “${t.name}”? Os cards que já o usaram não mudam.`)) return;
    const res = await deleteChecklistTemplate(t.id).catch(() => null);
    if (res?.ok) onChanged();
    else setError(res ? res.error : "Não foi possível excluir. Tente de novo.");
  }

  const btn = "min-h-9 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-20" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tpl-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-neutral-200 p-5">
          <h2 id="tpl-dialog-title" className="text-lg font-semibold text-neutral-800">
            Modelos de checklist
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Valem só para este pipeline. Alterar um modelo não muda os cards que já o usaram.
          </p>
        </div>
        <div className="grid gap-3 p-5">
          {editing ? (
            <>
              <label className="grid gap-1 text-sm text-neutral-700">
                Nome
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="min-h-10 rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-500"
                />
              </label>
              <label className="grid gap-1 text-sm text-neutral-700">
                Itens, um por linha
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={Math.min(16, Math.max(6, text.split("\n").length + 1))}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className={btn}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className="min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
                >
                  {busy ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </>
          ) : templates.length === 0 ? (
            <p className="text-sm text-neutral-600">Nenhum modelo ainda.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-sm text-neutral-800">
                    {t.name}{" "}
                    <span className="text-xs text-neutral-500">
                      ({t.items.length} {t.items.length === 1 ? "item" : "itens"})
                    </span>
                  </span>
                  <button type="button" onClick={() => open(t)} className={btn}>
                    Editar
                  </button>
                  <button type="button" onClick={() => remove(t)} className={btn + " text-red-700"}>
                    Excluir
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end border-t border-neutral-200 p-4">
          <button type="button" onClick={onClose} className={btn}>
            Fechar
          </button>
        </div>
      </div>
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
