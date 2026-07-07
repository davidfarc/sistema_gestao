"use client";

import { useState, type FormEvent } from "react";

import { addAttachment, deleteAttachment } from "@/lib/board/actions";
import type { AttachmentView } from "@/lib/board/types";

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

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    await addAttachment(cardId, url, label);
    setUrl("");
    setLabel("");
    onChanged();
  }

  return (
    <div className="grid gap-2">
      {attachments.length > 0 && (
        <ul className="grid gap-1">
          {attachments.map((a) => (
            <li key={a.id} className="group flex items-center gap-2">
              <span className="text-neutral-400">🔗</span>
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
                onClick={async () => {
                  await deleteAttachment(a.id);
                  onChanged();
                }}
                className="text-xs text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
                aria-label="Remover anexo"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Título (opcional)"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Colar link (qualquer URL)"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Anexar
        </button>
      </form>
    </div>
  );
}
