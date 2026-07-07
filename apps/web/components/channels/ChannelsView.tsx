"use client";

import clsx from "clsx";
import { Hash, Pencil, Search, Settings, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { MemberManagerDialog } from "@/components/common/MemberManagerDialog";
import type { ConversationView, MessageView, UserSearchResult } from "@/lib/board/types";
import {
  createChannel,
  loadChannelMembers,
  loadConversations,
  loadMessages,
  markRead,
  openOrCreateDm,
  postMessage,
  renameChannel,
  searchUsers,
  setChannelMember,
} from "@/lib/comms/actions";
import { createClient } from "@/lib/supabase/client";

function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Rótulo curto para a lista: hora se hoje, senão data. */
function listLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return clockLabel(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ChannelsView({
  canPost,
  canManageGroups,
  myId,
}: {
  canPost: boolean;
  canManageGroups: boolean;
  myId: string;
}) {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(false);
  const [managingGroup, setManagingGroup] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const refreshConversations = useCallback(async () => {
    const cs = await loadConversations();
    setConversations(cs);
    return cs;
  }, []);

  const loadGroupMembers = useCallback(() => loadChannelMembers(selected ?? ""), [selected]);
  const toggleGroupMember = useCallback(
    (uid: string, m: boolean) => setChannelMember(selected ?? "", uid, m),
    [selected],
  );

  useEffect(() => {
    refreshConversations().then((cs) => {
      setSelected((cur) => cur ?? cs[0]?.id ?? null);
    });
  }, [refreshConversations]);

  // Abre uma conversa: carrega mensagens, marca como lida e zera o contador.
  const openConversation = useCallback(async (channelId: string) => {
    setSelected(channelId);
    const msgs = await loadMessages(channelId);
    setMessages(msgs);
    await markRead(channelId);
    setConversations((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)),
    );
  }, []);

  useEffect(() => {
    if (selected) openConversation(selected);
    else setMessages([]);
    // openConversation é estável; só reage à mudança de seleção.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  // ── Realtime: mensagens novas sem recarregar ────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("comms-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message" },
        (payload) => {
          const row = payload.new as {
            id: string;
            channel_id: string;
            author_id: string;
            body: string;
            created_at: string;
          };
          if (row.channel_id === selectedRef.current) {
            // Conversa aberta: recarrega mensagens (resolve nomes) e marca lida.
            loadMessages(row.channel_id).then(setMessages);
            markRead(row.channel_id);
            setConversations((prev) =>
              prev
                .map((c) =>
                  c.id === row.channel_id
                    ? { ...c, lastMessage: row.body, lastMessageAt: row.created_at, unread: 0 }
                    : c,
                )
                .sort(byRecency),
            );
          } else {
            // Conversa em segundo plano: atualiza prévia, hora e não-lidas.
            setConversations((prev) => {
              const known = prev.some((c) => c.id === row.channel_id);
              if (!known) {
                // DM/grupo novo criado por outra pessoa → recarrega a lista.
                refreshConversations();
                return prev;
              }
              return prev
                .map((c) =>
                  c.id === row.channel_id
                    ? {
                        ...c,
                        lastMessage: row.body,
                        lastMessageAt: row.created_at,
                        unread: row.author_id === myId ? c.unread : c.unread + 1,
                      }
                    : c,
                )
                .sort(byRecency);
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, refreshConversations]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !selected) return;
    setBody("");
    await postMessage(selected, text);
    // Otimista: o realtime também chega, mas garante feedback imediato.
    setMessages(await loadMessages(selected));
    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === selected
            ? { ...c, lastMessage: text, lastMessageAt: new Date().toISOString() }
            : c,
        )
        .sort(byRecency),
    );
  }

  const active = conversations.find((c) => c.id === selected);

  return (
    <div className="flex h-dvh">
      {/* Lista de conversas */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-surface-low">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">Conversas</h2>
          {canPost && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              title="Nova conversa"
              className="flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
                selected === c.id ? "bg-primary/10" : "hover:bg-neutral-200/60",
              )}
            >
              <span
                className={clsx(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
                  c.kind === "dm" ? "bg-primary" : "bg-neutral-400",
                )}
              >
                {c.kind === "group" ? <Hash className="h-4 w-4" /> : c.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-800">{c.name}</span>
                  <span className="shrink-0 text-[10px] text-neutral-400">
                    {listLabel(c.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-neutral-500">
                    {c.lastMessage ?? "Sem mensagens ainda"}
                  </span>
                  {c.unread > 0 && (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                      {c.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-3 text-xs text-neutral-400">Nenhuma conversa ainda.</p>
          )}
        </nav>
      </aside>

      {/* Mensagens */}
      <section className="flex flex-1 flex-col">
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
              <span
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white",
                  active.kind === "dm" ? "bg-primary" : "bg-neutral-400",
                )}
              >
                {active.kind === "group" ? <Hash className="h-4 w-4" /> : active.initials}
              </span>
              <h1 className="text-base font-semibold text-neutral-800">{active.name}</h1>
              {active.kind === "group" && canManageGroups && (
                <button
                  type="button"
                  onClick={() => setManagingGroup(true)}
                  title="Gerenciar grupo"
                  aria-label="Gerenciar grupo"
                  className="ml-auto rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
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
                      <span className="ml-1 text-xs text-neutral-400">{clockLabel(m.createdAt)}</span>
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
                    placeholder={`Mensagem para ${active.name}`}
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
            Selecione ou inicie uma conversa.
          </div>
        )}
      </section>

      {composing && (
        <NewConversation
          canManageGroups={canManageGroups}
          onClose={() => setComposing(false)}
          onOpened={async (channelId) => {
            setComposing(false);
            await refreshConversations();
            if (channelId) setSelected(channelId);
          }}
        />
      )}

      {managingGroup && active?.kind === "group" && (
        <MemberManagerDialog
          title="Gerenciar grupo"
          topSlot={
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-500">Nome do grupo</span>
              <input
                defaultValue={active.name}
                onBlur={async (e) => {
                  const name = e.target.value.trim();
                  if (name && name !== active.name) {
                    await renameChannel(active.id, name);
                    await refreshConversations();
                  }
                }}
                className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
          }
          load={loadGroupMembers}
          onToggle={toggleGroupMember}
          onClose={() => setManagingGroup(false)}
        />
      )}
    </div>
  );
}

function byRecency(a: ConversationView, b: ConversationView): number {
  const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  return tb - ta;
}

// ── Painel "Nova conversa": DM por busca de pessoa, ou criar grupo ────────────

function NewConversation({
  canManageGroups,
  onClose,
  onOpened,
}: {
  canManageGroups: boolean;
  onClose: () => void;
  onOpened: (channelId: string) => void;
}) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "dm") return;
    let cancelled = false;
    searchUsers(query).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [query, mode]);

  async function pick(userId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const channelId = await openOrCreateDm(userId);
      onOpened(channelId);
    } finally {
      setBusy(false);
    }
  }

  async function makeGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || busy) return;
    setBusy(true);
    try {
      await createChannel(groupName);
      // Recarrega a lista; o novo canal aparece no topo (sem selecionar).
      onOpened("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">Nova conversa</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-neutral-200 px-3 py-2">
          <button
            type="button"
            onClick={() => setMode("dm")}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              mode === "dm" ? "bg-primary/10 text-primary" : "text-neutral-500 hover:bg-neutral-100",
            )}
          >
            <Search className="h-3.5 w-3.5" /> Pessoa
          </button>
          {canManageGroups && (
            <button
              type="button"
              onClick={() => setMode("group")}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                mode === "group" ? "bg-primary/10 text-primary" : "text-neutral-500 hover:bg-neutral-100",
              )}
            >
              <Users className="h-3.5 w-3.5" /> Grupo
            </button>
          )}
        </div>

        {mode === "dm" ? (
          <div className="p-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pessoa por nome ou e-mail…"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-neutral-100 disabled:opacity-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {u.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-800">{u.name}</span>
                    <span className="block truncate text-xs text-neutral-400">{u.email}</span>
                  </span>
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-2 py-3 text-xs text-neutral-400">Nenhuma pessoa encontrada.</p>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={makeGroup} className="space-y-2 p-3">
            <input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nome do grupo"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <p className="text-xs text-neutral-400">
              Todos os membros internos entram no grupo.
            </p>
            <button
              type="submit"
              disabled={!groupName.trim() || busy}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
            >
              Criar grupo
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
