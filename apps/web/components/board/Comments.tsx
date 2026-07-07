"use client";

import { useRef, useState, type FormEvent } from "react";

import { addComment, deleteComment } from "@/lib/board/actions";
import type { CommentView, MemberOption } from "@/lib/board/types";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Segmento @ ativo entre o último "@" e o cursor (sem quebra de linha). */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // "@" precisa estar no início ou após espaço/quebra.
  const prev = at > 0 ? before[at - 1] : " ";
  if (prev && !/\s/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 30) return null;
  return { start: at, query };
}

export function Comments({
  cardId,
  comments,
  members,
  onChanged,
}: {
  cardId: string;
  comments: CommentView[];
  members: MemberOption[];
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = menu
    ? members
        .filter((m) => m.name.toLowerCase().includes(menu.query.toLowerCase()))
        .slice(0, 6)
    : [];

  function onType(value: string, caret: number) {
    setBody(value);
    setMenu(activeMention(value, caret));
  }

  function choose(m: MemberOption) {
    if (!menu) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? body.length;
    const next = body.slice(0, menu.start) + `@${m.name} ` + body.slice(caret);
    setBody(next);
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, { id: m.id, name: m.name }]));
    setMenu(null);
    // Recoloca o foco após o token inserido.
    requestAnimationFrame(() => {
      const pos = menu.start + m.name.length + 2;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    // Só menções cujo "@Nome" ainda está no texto.
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    await addComment(cardId, body, mentions);
    setBody("");
    setPicked([]);
    setMenu(null);
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
        <div className="relative">
          <textarea
            ref={taRef}
            value={body}
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyUp={(e) => setMenu(activeMention(body, e.currentTarget.selectionStart))}
            onClick={(e) => setMenu(activeMention(body, e.currentTarget.selectionStart))}
            rows={2}
            placeholder="Escreva um comentário… use @ para mencionar"
            className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          {menu && suggestions.length > 0 && (
            <ul className="absolute left-2 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
              {suggestions.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(m);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                      {m.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
