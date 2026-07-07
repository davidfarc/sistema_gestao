"use client";

import { useState, type FormEvent } from "react";

import { addComment, deleteComment } from "@/lib/board/actions";
import type { CommentView } from "@/lib/board/types";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function Comments({
  cardId,
  comments,
  onChanged,
}: {
  cardId: string;
  comments: CommentView[];
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    await addComment(cardId, body);
    setBody("");
    onChanged();
    setPending(false);
  }

  return (
    <div className="grid gap-3">
      {comments.length > 0 && (
        <ul className="grid gap-3">
          {comments.map((c) => (
            <li key={c.id} className="group flex items-start gap-2">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white"
                title={c.authorName}
              >
                {c.authorName.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold">{c.authorName}</span>
                  <span className="ml-1 text-xs text-neutral-400">· {timeAgo(c.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap text-sm text-neutral-700">{c.body}</p>
              </div>
              {c.isOwn && (
                <button
                  type="button"
                  onClick={async () => {
                    await deleteComment(c.id);
                    onChanged();
                  }}
                  className="text-xs text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
                  aria-label="Remover comentário"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="grid gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Escreva um comentário…"
          className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {pending ? "Enviando…" : "Comentar"}
          </button>
        </div>
      </form>
    </div>
  );
}
