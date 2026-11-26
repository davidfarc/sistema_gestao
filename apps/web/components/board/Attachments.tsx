"use client";

import { useState, type FormEvent } from "react";

import { addAttachment, deleteAttachment, updateAttachment } from "@/lib/board/actions";
import type { AttachmentView } from "@/lib/board/types";

const IMAGE = /\.(png|jpe?g|gif|webp)([?#].*)?$/i;

const input =
  "min-w-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500";
const smallBtn =
  "inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900";

export function Attachments({
  cardId,
  attachments,
  onChanged,
}: {
  cardId: string;
  attachments: AttachmentView[];
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    await run(async () => {
      await addAttachment(cardId, url, label);
      setUrl("");
      setLabel("");
    });
  }

  async function save(e: FormEvent, id: string) {
    e.preventDefault();
    await run(async () => {
      await updateAttachment(id, editUrl, editLabel);
      setEditing(null);
    });
  }

  return (
    <div className="grid gap-2">
      {attachments.length > 0 && (
        <ul className="grid gap-1">
          {attachments.map((a) =>
            editing === a.id ? (
              <li key={a.id}>
                <form onSubmit={(e) => save(e, a.id)} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto]">
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="Título (opcional)"
                    aria-label="Título do anexo"
                    className={input}
                  />
                  <input
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder="Link"
                    aria-label="Link do anexo"
                    className={input}
                  />
                  <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white">
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancelar
                  </button>
                </form>
              </li>
            ) : (
              <li key={a.id} className="flex items-center gap-2">
                <span className="text-neutral-600" aria-hidden="true">
                  {IMAGE.test(a.url) ? "🖼️" : "🔗"}
                </span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-sky-700 hover:underline"
                  title={a.url}
                >
                  {a.label || a.url}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(a.id);
                    setEditUrl(a.url);
                    setEditLabel(a.label);
                  }}
                  className={smallBtn}
                  aria-label={`Editar anexo ${a.label || a.url}`}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Excluir o anexo "${a.label || a.url}"?`)) return;
                    void run(() => deleteAttachment(a.id));
                  }}
                  className={`${smallBtn} hover:bg-red-50 hover:text-red-700`}
                  aria-label={`Excluir anexo ${a.label || a.url}`}
                >
                  Excluir
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Título (opcional)" className={input} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Colar link (qualquer URL)" className={input} />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Anexar
        </button>
      </form>
    </div>
  );
}
