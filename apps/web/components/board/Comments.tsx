"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

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
  composerSlot = null,
}: {
  cardId: string;
  comments: CommentView[];
  members: MemberOption[];
  onChanged: () => void;
  /**
   * Celular: elemento do rodapé fixo do card. Quando informado, o campo de
   * escrever é desenhado lá (compacto), e aqui fica só a lista.
   */
  composerSlot?: HTMLElement | null;
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

  const docked = composerSlot !== null;
  const form = (
      <form onSubmit={submit} className={docked ? "flex items-end gap-2" : "grid gap-2"}>
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={taRef}
            value={body}
            onChange={(e) => onType(e.target.value, e.target.selectionStart)}
            onKeyUp={(e) => setMenu(activeMention(body, e.currentTarget.selectionStart))}
            onClick={(e) => setMenu(activeMention(body, e.currentTarget.selectionStart))}
            rows={docked ? 1 : 2}
            aria-label="Novo comentário"
            placeholder={docked ? "Comentar… (@ menciona)" : "Escreva um comentário… use @ para mencionar"}
            // 16 px no celular: abaixo disso o iPhone dá zoom ao focar o campo.
            className={
              "block w-full rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-500 sm:text-sm " +
              (docked ? "max-h-32 resize-none" : "resize-y")
            }
          />
          {menu && suggestions.length > 0 && (
            <ul
              className={
                "absolute left-2 z-10 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg " +
                // No rodapé a lista abre para cima (embaixo não há espaço).
                (docked ? "bottom-full mb-1" : "top-full mt-1")
              }
            >
              {suggestions.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(m);
                    }}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100"
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
        <div className={docked ? "shrink-0" : "flex justify-end"}>
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {pending ? "Enviando…" : docked ? "Enviar" : "Comentar"}
          </button>
        </div>
      </form>
  );

  return (
    <div className="grid gap-3">
      {docked && comments.length === 0 && (
        <p className="text-sm text-neutral-600">Nenhum comentário ainda.</p>
      )}
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
                  // No toque não existe "passar o mouse": no celular o botão fica sempre visível.
                  className="-m-2 p-2 text-sm text-neutral-500 hover:text-red-600 md:text-neutral-300 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label="Remover comentário"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {docked ? createPortal(form, composerSlot) : form}
    </div>
  );
}
