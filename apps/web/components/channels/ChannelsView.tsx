"use client";

import clsx from "clsx";
import { Hash } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ChannelView, MessageView } from "@/lib/board/types";
import { createChannel, loadChannels, loadMessages, postMessage } from "@/lib/comms/actions";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ChannelsView({ canPost }: { canPost: boolean }) {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [body, setBody] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadChannels().then((cs) => {
      setChannels(cs);
      setSelected((cur) => cur ?? cs[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (selected) loadMessages(selected).then(setMessages);
    else setMessages([]);
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || !selected) return;
    await postMessage(selected, body);
    setBody("");
    setMessages(await loadMessages(selected));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    await createChannel(newChannel);
    setNewChannel("");
    setCreating(false);
    setChannels(await loadChannels());
  }

  const selectedName = channels.find((c) => c.id === selected)?.name;

  return (
    <div className="flex h-dvh">
      {/* Canais */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-surface-low">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">Canais</h2>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={clsx(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
                selected === c.id
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-neutral-600 hover:bg-neutral-200/60",
              )}
            >
              <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          {channels.length === 0 && (
            <p className="px-2 py-3 text-xs text-neutral-400">Nenhum canal ainda.</p>
          )}
        </nav>
        {canPost && (
          <div className="border-t border-neutral-200 p-2">
            {creating ? (
              <form onSubmit={create} className="flex gap-1">
                <input
                  autoFocus
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  placeholder="nome do canal"
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm outline-none"
                />
                <button type="submit" className="rounded bg-primary px-2 text-xs font-medium text-white">
                  Criar
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-primary/5"
              >
                + Novo canal
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Mensagens */}
      <section className="flex flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center gap-1.5 border-b border-neutral-200 px-5 py-3">
              <Hash className="h-4 w-4 text-neutral-400" />
              <h1 className="text-base font-semibold text-neutral-800">{selectedName}</h1>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white"
                    title={m.authorName}
                  >
                    {m.authorName.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-semibold">{m.authorName}</span>
                      <span className="ml-1 text-xs text-neutral-400">{timeLabel(m.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-neutral-700">{m.body}</p>
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-sm text-secondary">Nenhuma mensagem. Comece a conversa!</p>
              )}
              <div ref={bottomRef} />
            </div>

            {canPost && (
              <form onSubmit={send} className="border-t border-neutral-200 p-3">
                <div className="flex gap-2">
                  <input
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={`Mensagem para #${selectedName}`}
                    className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
                  />
                  <button
                    type="submit"
                    disabled={!body.trim()}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
                  >
                    Enviar
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-secondary">
            Selecione ou crie um canal.
          </div>
        )}
      </section>
    </div>
  );
}
