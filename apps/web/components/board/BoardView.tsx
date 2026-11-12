"use client";

import { ListOrdered, Search, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Placement } from "@ecco/core";

import { BoardProvider } from "./BoardContext";
import { CardPanel } from "./CardPanel";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { NewCardDialog } from "./NewCardDialog";
import { PipelineSelector } from "./PipelineSelector";
import { createCardInStage, moveCard } from "@/lib/board/actions";
import { memberView } from "@/lib/board/avatar";
import {
  applyCardRow,
  applyMove,
  cardFromRow,
  faceFromPage,
  sortCards,
  type CardRow,
} from "@/lib/board/localState";
import { createClient } from "@/lib/supabase/client";
import {
  LAST_BOARD_COOKIE,
  type BoardData,
  type BoardSummary,
  type CardPageData,
  type CardView,
} from "@/lib/board/types";

type View = "kanban" | "list";

const viewKey = (boardId: string) => `ecco_visao_${boardId}`;

/** Carregamentos do servidor que esta aba já mostrou (ver "Dados velhos"). */
const seenLoads = new Set<number>();

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

  const gated = useMemo(() => new Set(board.gatedStageIds), [board.gatedStageIds]);
  // Sempre o valor mais novo, para os avisos do Realtime (que vivem num efeito
  // montado uma vez só) não trabalharem com uma lista antiga.
  const gatedRef = useRef(gated);
  gatedRef.current = gated;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Recarrega do servidor, juntando pedidos em rajada (400 ms de silêncio).
  // É o caminho de exceção: o normal é a tela se atualizar sozinha, abaixo.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  }, [router]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  // Tempo real. Mudança num card que a tela já conhece (título, etapa, ordem,
  // prazo) é aplicada direto na lista, sem ir ao servidor — inclusive o "eco"
  // das gravações desta própria tela. Só o que a tela não resolve sozinha
  // (card novo de outra pessoa, solicitante trocado, etapas) recarrega.
  // O RLS filtra o que cada pessoa recebe.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`board-${board.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "card", filter: `board_id=eq.${board.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) setCards((prev) => prev.filter((c) => c.id !== id));
            return;
          }
          const row = payload.new as CardRow;
          const known = cardsRef.current.some((c) => c.id === row.id);
          const resolvable = known
            ? applyCardRow(cardsRef.current, row, gatedRef.current) !== null
            : cardFromRow(cardsRef.current, row, gatedRef.current) !== null;
          if (!resolvable) {
            refreshSoon();
            return;
          }
          setCards((prev) => {
            if (prev.some((c) => c.id === row.id)) {
              return applyCardRow(prev, row, gatedRef.current) ?? prev;
            }
            const created = cardFromRow(prev, row, gatedRef.current);
            return created ? sortCards([...prev, created]) : prev;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stage", filter: `board_id=eq.${board.id}` },
        refreshSoon,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [board.id, refreshSoon]);

  // Dados velhos. (1) Ao voltar pelo "voltar" do navegador o Next remonta a
  // tela com a página que tinha guardado: se estes mesmos dados já foram
  // montados antes, recarrega. (2) Aba que ficou mais de 1 min em segundo plano
  // pode ter perdido avisos do Realtime (celular dormindo): recarrega ao voltar.
  useEffect(() => {
    if (seenLoads.has(board.loadedAt)) router.refresh();
    seenLoads.add(board.loadedAt);
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // Só na montagem: `loadedAt` muda a cada recarga e não deve refazer o efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);

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


  /** Altera um card só na tela (a gravação é de quem chama). */
  const patchCard = useCallback((cardId: string, patch: Partial<CardView>) => {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
  }, []);

  // Otimista: muda de etapa e de lugar na hora, com a mesma conta de posição
  // que o servidor fará. Se um gate barrar ou a gravação falhar, recarrega do
  // servidor (volta ao estado real). Sem `placement` (Lista): fim da coluna.
  function move(cardId: string, toStageId: string, placement?: Placement) {
    setMoveError(null);
    // Pela Lista, escolher a etapa em que o card já está não muda nada.
    if (!placement && cards.find((c) => c.id === cardId)?.stageId === toStageId) return;
    setCards((prev) => applyMove(prev, cardId, toStageId, placement, gated));
    moveCard(cardId, toStageId, placement)
      .then((res) => {
        if (!res.ok) {
          setMoveError(res.reason);
          router.refresh();
        }
      })
      .catch(() => {
        setMoveError("Não foi possível mover o card. Tente de novo.");
        router.refresh();
      });
  }

  // O painel do card gravou algo e já buscou o card de novo: reflete na face.
  const cardSaved = useCallback(
    (data: CardPageData) => {
      const face = faceFromPage(data);
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== data.id) return c;
          // Pessoa arquivada não vem na lista de membros: mantém o nome que já havia.
          const keep = (next: CardView["assignee"], cur: CardView["assignee"]) =>
            next && cur && next.id === cur.id && next.name === "?" ? cur : next;
          return {
            ...c,
            ...face,
            assignee: keep(face.assignee ?? null, c.assignee),
            requester: keep(face.requester ?? null, c.requester),
          };
        }),
      );
    },
    [],
  );

  // "+ Adicionar card" no pé da coluna: só no formulário simples (os outros
  // pedem campos que o campo de título sozinho não coleta).
  async function addCard(stageId: string, title: string) {
    setMoveError(null);
    try {
      const created = await createCardInStage(board.id, title, stageId);
      if (created.blockedReason) setMoveError(created.blockedReason);
      const card: CardView = {
        id: created.id,
        number: created.number,
        title: created.title,
        stageId: created.stageId,
        position: created.position,
        assignee: null,
        requester: myUserId ? memberView(myUserId, created.requesterName) : null,
        labels: [],
        dueDate: null,
        status: null,
        fields: [],
        checklist: null,
        commentCount: 0,
        awaitingPrioritization: gated.has(created.stageId),
        prioritized: false,
      };
      // O aviso do Realtime pode ter chegado antes e já provocado uma recarga
      // com este card: nesse caso não duplica.
      setCards((prev) => (prev.some((c) => c.id === card.id) ? prev : sortCards([...prev, card])));
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
            onMove={move}
            onPatchCard={patchCard}
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
          onSaved={cardSaved}
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
