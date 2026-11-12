"use client";

import clsx from "clsx";
import { ArrowLeft, Hash, Pencil, Search, Settings, Users, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
import { useIsMobile } from "@/lib/useIsMobile";

/** Conversa aberta no endereço (`/canais?conversa=<id>`): dá link e faz o "voltar" funcionar no celular. */
const PARAM = "conversa";

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

  // Celular: uma tela por vez (lista → conversa). Computador: lista e conversa
  // lado a lado, como sempre.
  const isMobile = useIsMobile();
  const urlConversation = useSearchParams().get(PARAM);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Qual conversa abrir. O endereço manda (link direto, "voltar" do navegador).
  // Sem nada no endereço: no computador abre a mais recente; no celular fica
  // na lista, que é a primeira tela.
  useEffect(() => {
    if (isMobile === null) return;
    if (urlConversation) {
      if (conversations.some((c) => c.id === urlConversation)) setSelected(urlConversation);
      return;
    }
    if (isMobile) setSelected(null);
    else setSelected((cur) => cur ?? conversations[0]?.id ?? null);
  }, [isMobile, urlConversation, conversations]);

  /**
   * Escolhe uma conversa e a registra no endereço. No celular a primeira
   * escolha entra no histórico (o "voltar" retorna à lista); trocar de conversa
   * e o computador só substituem o endereço, sem empilhar.
   */
  const choose = useCallback(
    (channelId: string) => {
      setSelected(channelId);
      const params = new URLSearchParams(window.location.search);
      const push = isMobile === true && !params.has(PARAM);
      params.set(PARAM, channelId);
      if (push) window.history.pushState({ eccoConversa: true }, "", `?${params}`);
      else {
        // Só a nossa marca é repassada: com o estado interno do Next junto, ele
        // trataria a troca como dele e não avisaria o `useSearchParams`.
        const mark = (window.history.state as { eccoConversa?: boolean } | null)?.eccoConversa;
        window.history.replaceState(mark ? { eccoConversa: true } : null, "", `?${params}`);
      }
    },
    [isMobile],
  );

  /** Volta para a lista (celular). */
  function backToList() {
    if ((window.history.state as { eccoConversa?: boolean } | null)?.eccoConversa) {
      window.history.back();
      return;
    }
    // Chegou por link direto: não há entrada anterior, só limpa o endereço.
    const params = new URLSearchParams(window.location.search);
    params.delete(PARAM);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    setSelected(null);
  }

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
    <div className="flex h-[calc(100dvh-var(--bottom-nav))]">
      {/* Lista de conversas */}
      <aside
        className={clsx(
          "w-full shrink-0 flex-col border-r border-neutral-200 bg-surface-low md:flex md:w-72",
          selected ? "hidden" : "flex",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">Conversas</h2>
          {canPost && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              title="Nova conversa"
              aria-label="Nova conversa"
              className="flex h-11 w-11 items-center justify-center rounded-md text-primary hover:bg-primary/10 md:h-8 md:w-8"
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
              onClick={() => choose(c.id)}
              aria-current={selected === c.id ? "true" : undefined}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-3 text-left md:py-2",
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
                  <span className="shrink-0 text-xs text-neutral-500">
                    {listLabel(c.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-neutral-500">
                    {c.lastMessage ?? "Sem mensagens ainda"}
                  </span>
                  {c.unread > 0 && (
                    <span
                      aria-label={`${c.unread} não lidas`}
                      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-white"
                    >
                      {c.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-3 text-sm text-neutral-600">Nenhuma conversa ainda.</p>
          )}
        </nav>
      </aside>

      {/* Mensagens */}
      <section className={clsx("min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}>
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b border-neutral-200 px-2 py-2 md:px-5 md:py-3">
              <button
                type="button"
                onClick={backToList}
                aria-label="Voltar para a lista de conversas"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100 md:hidden"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <span
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white",
                  active.kind === "dm" ? "bg-primary" : "bg-neutral-400",
                )}
              >
                {active.kind === "group" ? <Hash className="h-4 w-4" /> : active.initials}
              </span>
              <h1 className="min-w-0 truncate text-base font-semibold text-neutral-800">{active.name}</h1>
              {active.kind === "group" && canManageGroups && (
                <button
                  type="button"
                  onClick={() => setManagingGroup(true)}
                  title="Gerenciar grupo"
                  aria-label="Gerenciar grupo"
                  className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 md:h-8 md:w-8"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:p-5">
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
                    aria-label={`Mensagem para ${active.name}`}
                    // 16 px no celular: abaixo disso o iPhone dá zoom ao focar.
                    className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base outline-none focus:border-neutral-500 md:text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!body.trim()}
                    className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50 md:min-h-0 md:py-2"
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
            if (channelId) choose(channelId);
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-12 md:pt-24"
      onClick={onClose}
    >
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
