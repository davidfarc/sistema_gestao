"use client";

import { ListOrdered, Search, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { placementIndex, type Placement } from "@ecco/core";

import { BoardProvider } from "./BoardContext";
import { CardPanel } from "./CardPanel";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { NewCardDialog } from "./NewCardDialog";
import { PipelineSelector } from "./PipelineSelector";
import { createCardInStage, moveCard } from "@/lib/board/actions";
import { createClient } from "@/lib/supabase/client";
import { LAST_BOARD_COOKIE, type BoardData, type BoardSummary } from "@/lib/board/types";

type View = "kanban" | "list";

const viewKey = (boardId: string) => `ecco_visao_${boardId}`;

export interface BoardCaps {
  fields: boolean; // editar propriedades (field:manage)
  stages: boolean; // configurar etapas (stage:manage)
  boards: boolean; // criar/renomear/arquivar pipelines (board:configure)
  alcadas: boolean; // limites de alçada (Direção Geral ou Gestor)
  create: boolean; // criar cards (card:create)
}

export function BoardView({
  board,
  boards,
  caps,
  myUserId = null,
}: {
  board: BoardData;
  boards: BoardSummary[];
  caps: BoardCaps;
  myUserId?: string | null;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(board.cards);
  const [view, setView] = useState<View>("kanban");
  // O card aberto mora na URL (`?card=<id>`): tem link, e o "voltar" do
  // navegador fecha o card em vez de sair do quadro.
  const selectedCardId = useSearchParams().get("card");
  const openedHere = useRef(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);

  // Visão escolhida (Kanban/Lista) lembrada por pipeline, neste navegador.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(viewKey(board.id));
      if (saved === "kanban" || saved === "list") setView(saved);
    } catch {
      // Armazenamento bloqueado (aba anônima): segue no Kanban.
    }
  }, [board.id]);

  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(viewKey(board.id), next);
    } catch {
      // Sem armazenamento: a escolha vale só até recarregar.
    }
  }

  // Tempo real: qualquer mudança em cards ou etapas deste pipeline (feita por
  // outra pessoa ou em outra aba) recarrega os dados do servidor. As mudanças
  // chegam em rajada (um move grava card + atividade), então espera 400 ms
  // de silêncio antes de buscar. O RLS filtra o que cada pessoa recebe.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`board-${board.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card", filter: `board_id=eq.${board.id}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stage", filter: `board_id=eq.${board.id}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [board.id, router]);

  // Busca e "Meus cards" valem para as duas visões.
  const shownCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !onlyMine) return cards;
    return cards.filter((c) => {
      if (onlyMine && c.assignee?.id !== myUserId) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        String(c.number).includes(q.replace(/^#/, "")) ||
        (c.assignee?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [cards, query, onlyMine, myUserId]);
  const filtering = shownCards.length !== cards.length || !!query.trim() || onlyMine;

  // Sincroniza com o servidor após router.refresh() (ex.: card recém-criado).
  useEffect(() => setCards(board.cards), [board.cards]);

  // Lembra o pipeline aberto para que "Quadro" no menu volte pra cá. Um ano,
  // Lax (só navegação normal precisa lê-lo) e sem `secure` para o localhost.
  useEffect(() => {
    document.cookie = `${LAST_BOARD_COOKIE}=${board.id}; path=/; max-age=31536000; samesite=lax`;
  }, [board.id]);

  const selectedStageId = cards.find((c) => c.id === selectedCardId)?.stageId;
  const selectedStageName = board.stages.find((s) => s.id === selectedStageId)?.name;

  // `history.pushState` (e não `router.push`): muda o endereço sem refazer as
  // consultas do quadro. O Next mantém `useSearchParams` em dia com ele.
  const openCard = useCallback((cardId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("card", cardId);
    openedHere.current = true;
    window.history.pushState(null, "", `?${params}`);
  }, []);

  const closeCard = useCallback(() => {
    // Abriu por clique: desfaz a entrada do histórico. Chegou por link direto:
    // não há para onde voltar, então só tira o card do endereço.
    if (openedHere.current) {
      window.history.back();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("card");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  useEffect(() => {
    if (!selectedCardId) openedHere.current = false;
  }, [selectedCardId]);

  const refreshBoard = useCallback(() => router.refresh(), [router]);

  function move(cardId: string, toStageId: string, placement: Placement) {
    setMoveError(null);
    // Otimista: muda de etapa e de lugar na hora (a ordem da lista É a ordem
    // na coluna); se um gate barrar no servidor, reverte.
    setCards((prev) => {
      const moving = prev.find((c) => c.id === cardId);
      if (!moving) return prev;
      const rest = prev.filter((c) => c.id !== cardId);
      const column = rest.filter((c) => c.stageId === toStageId).map((c) => c.id);
      // Card que fica logo abaixo na coluna de destino (undefined = vai para o fim).
      const nextId = column[placementIndex(column, placement)];
      const at = nextId ? rest.findIndex((c) => c.id === nextId) : rest.length;
      return [...rest.slice(0, at), { ...moving, stageId: toStageId }, ...rest.slice(at)];
    });
    moveCard(cardId, toStageId, placement)
      .then((res) => {
        if (!res.ok) {
          setMoveError(res.reason);
          router.refresh(); // reverte para o estado real do servidor
        }
      })
      .catch(() => {
        setMoveError("Não foi possível mover o card. Tente de novo.");
        router.refresh();
      });
  }

  // "+ Adicionar card" no pé da coluna: só no formulário simples (os outros
  // pedem campos que o campo de título sozinho não coleta).
  async function addCard(stageId: string, title: string) {
    setMoveError(null);
    try {
      const created = await createCardInStage(board.id, title, stageId);
      if (created.blockedReason) setMoveError(created.blockedReason);
      router.refresh();
    } catch {
      // Em produção o Next esconde o texto do erro do servidor; a mensagem é genérica.
      setMoveError("Não foi possível criar o card. Recarregue a página e tente de novo.");
    }
  }
  const canAddInColumn = caps.create && board.creationForm === "simple";

  return (
    <BoardProvider
      boardId={board.id}
      creationForm={board.creationForm}
      thresholds={board.alcadaThresholds}
      myUserId={myUserId}
      intake={board.intake}
    >
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 py-3 pl-14 pr-4 md:px-6">
        <div>
          <PipelineSelector
            boards={boards}
            currentId={board.id}
            canConfigure={caps.boards}
            canManageAlcadas={caps.alcadas}
          />
          <p className="px-1.5 text-xs text-neutral-500">
            {filtering ? `${shownCards.length} de ${cards.length} cards` : `${cards.length} cards`}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="relative">
            <span className="sr-only">Buscar card</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar card…"
              className="w-40 rounded-lg border border-neutral-200 py-1.5 pl-8 pr-7 text-sm outline-none focus:border-neutral-400 sm:w-52 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          {myUserId && (
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              aria-pressed={onlyMine}
              title="Mostrar só os cards em que sou responsável"
              className={
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors " +
                (onlyMine
                  ? "border-primary bg-primary text-white"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50")
              }
            >
              <User className="h-4 w-4" aria-hidden="true" /> Meus cards
            </button>
          )}
          {/* Fila de priorização: só existe no pipeline de demandas. */}
          {board.creationForm === "custom:demandas" && (
            <Link
              href={`/prioridades?board=${board.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
              title="Fila de prioridade (RICE)"
            >
              <ListOrdered className="h-4 w-4" /> Prioridades
            </Link>
          )}
          <div className="flex rounded-lg border border-neutral-200 p-0.5 text-sm">
            <ToggleButton active={view === "kanban"} onClick={() => chooseView("kanban")}>
              Kanban
            </ToggleButton>
            <ToggleButton active={view === "list"} onClick={() => chooseView("list")}>
              Lista
            </ToggleButton>
          </div>
          <NewCardDialog canCreate={caps.create} />
        </div>
      </header>

      {moveError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800"
        >
          <span>{moveError}</span>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            className="ml-auto text-amber-600 hover:text-amber-900"
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 md:p-6">
        {view === "kanban" ? (
          <KanbanBoard
            stages={board.stages}
            cards={shownCards}
            onMove={move}
            onError={setMoveError}
            onOpenCard={openCard}
            canConfigure={caps.stages}
            onAddCard={canAddInColumn ? addCard : undefined}
          />
        ) : (
          <ListView
            cards={shownCards}
            stages={board.stages}
            onOpenCard={openCard}
            canConfigure={caps.fields}
          />
        )}
      </div>

      {selectedCardId && (
        <CardPanel
          cardId={selectedCardId}
          stageName={selectedStageName}
          myUserId={myUserId}
          onClose={closeCard}
          onChanged={refreshBoard}
        />
      )}
    </div>
    </BoardProvider>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-md px-3 py-1 font-medium transition-colors " +
        (active ? "bg-primary text-white" : "text-neutral-500 hover:text-neutral-800")
      }
    >
      {children}
    </button>
  );
}
