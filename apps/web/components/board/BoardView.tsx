"use client";

import { Archive, ListOrdered, Search, Settings2, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Placement } from "@ecco/core";

import { ArchivedDialog } from "./ArchivedDialog";
import { BoardOptionsDialog } from "./BoardOptionsDialog";
import { MyTasksView } from "./MyTasksView";
import { BoardExtrasProvider, BoardProvider, type BoardExtras } from "./BoardContext";
import { CardPanel } from "./CardPanel";
import { KanbanBoard } from "./KanbanBoard";
import { MobileBoard } from "./MobileBoard";
import { ListView } from "./ListView";
import { NewCardDialog } from "./NewCardDialog";
import { PipelineSelector } from "./PipelineSelector";
import { createCardInStage, loadCardPage, loadListData, moveCard } from "@/lib/board/actions";
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
import { useIsMobile } from "@/lib/useIsMobile";
import {
  LAST_BOARD_COOKIE,
  type BoardData,
  type BoardSummary,
  type CardPageData,
  type CardView,
} from "@/lib/board/types";

type View = "kanban" | "list" | "mine";

const viewKey = (boardId: string) => `ecco_visao_${boardId}`;

/** Carregamentos do servidor que esta aba já mostrou (ver "Dados velhos"). */
const seenLoads = new Set<number>();

export interface BoardCaps {
  fields: boolean; // editar propriedades (field:manage)
  stages: boolean; // configurar etapas (stage:manage)
  boards: boolean; // criar/renomear/arquivar pipelines (board:configure)
  alcadas: boolean; // limites de alçada (Direção Geral ou Gestor)
  create: boolean; // criar cards (card:create)
  readAll: boolean; // ver todos os cards do pipeline (card:read_all); sem isto, só os próprios
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
  // Celular: uma etapa por vez, sem arrastar e sem a Lista (tabela larga demais).
  const isMobile = useIsMobile();
  // Medidas para o cabeçalho preso: largura da área de conteúdo e altura do
  // cabeçalho (o nome das etapas prende logo abaixo dele). A largura vem da
  // própria área, com 1px de folga, NUNCA da janela arredondada: com zoom no navegador o cabeçalho ficava alguns pixels mais
  // largo que a área, criava uma barra de rolagem que mudava a medida, e a
  // página ficava tremendo.
  const shellRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const shell = shellRef.current;
    const head = headRef.current;
    if (!shell || !head) return;
    const area = shell.parentElement;
    const measure = () => {
      if (area) {
        // `clientWidth` vem na unidade do CSS e arredondado; 1px a menos
        // garante que o cabeçalho nunca passe da área.
        shell.style.setProperty("--head-w", `${Math.max(0, area.clientWidth - 1)}px`);
      }
      shell.style.setProperty("--board-head-h", `${head.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    if (area) ro.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  // O card aberto mora na URL (`?card=<id>`): tem link, e o "voltar" do
  // navegador fecha o card em vez de sair do quadro.
  const selectedCardId = useSearchParams().get("card");
  const openedHere = useRef(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // Visão escolhida lembrada por pipeline, neste navegador. Sem escolha
  // salva: em pipeline com "Minhas demandas", quem não gerencia abre nela.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(viewKey(board.id));
    } catch {
      // Armazenamento bloqueado (aba anônima): usa o padrão.
    }
    if (saved === "kanban" || saved === "list") setView(saved);
    else if (saved === "mine" && board.myTasks) setView("mine");
    else setView(board.myTasks && !caps.boards ? "mine" : "kanban");
  }, [board.id, board.myTasks, caps.boards]);

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
  //
  // Cards e etapas vão em canais SEPARADOS: se uma das tabelas não estiver
  // publicada no Realtime, o Supabase recusa o canal inteiro, e juntas uma
  // derrubaria a outra. Se um canal falhar, a tela cai para um plano B:
  // recarrega do servidor a cada 20 s enquanto estiver visível.
  useEffect(() => {
    const supabase = createClient();
    const failed = new Set<string>();
    let poll: ReturnType<typeof setInterval> | null = null;
    const watch = (name: string) => (status: string) => {
      if (status === "SUBSCRIBED") failed.delete(name);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!failed.has(name)) console.warn(`[quadro] tempo real indisponível para "${name}" (${status})`);
        failed.add(name);
      }
      if (failed.size > 0 && !poll) {
        poll = setInterval(() => {
          if (document.visibilityState === "visible") router.refresh();
        }, 20_000);
      } else if (failed.size === 0 && poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    const cardChannel = supabase
      .channel(`board-cards-${board.id}`)
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
          // Arquivado (por qualquer pessoa): sai do quadro na hora.
          if (row.archived_at) {
            setCards((prev) => prev.filter((c) => c.id !== row.id));
            return;
          }
          const known = cardsRef.current.some((c) => c.id === row.id);
          // Card que a tela não tinha e que não é novo (reativado, ou vindo de
          // outro pipeline): já tem responsável, checklist… Só o servidor sabe.
          if (!known && payload.eventType === "UPDATE") {
            refreshSoon();
            return;
          }
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
      .subscribe(watch("card"));
    const stageChannel = supabase
      .channel(`board-stages-${board.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stage", filter: `board_id=eq.${board.id}` },
        refreshSoon,
      )
      .subscribe(watch("stage"));
    return () => {
      if (poll) clearInterval(poll);
      supabase.removeChannel(cardChannel);
      supabase.removeChannel(stageChannel);
    };
  }, [board.id, refreshSoon, router]);

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
    if (cardId.startsWith("tmp-")) return; // ainda sendo gravado
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
    if (cardId.startsWith("tmp-")) return; // ainda sendo gravado
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
  // ── Dados extras do pipeline (propriedades, valores, pessoas, modelos) ─────
  // Buscados uma vez, logo depois de o quadro aparecer, e reaproveitados pela
  // Lista e pelos formulários de criação: abrir qualquer um não espera o servidor.
  const [extras, setExtras] = useState<BoardExtras | null>(null);
  const reloadExtras = useCallback(async () => {
    try {
      const data = await loadListData(board.id);
      setExtras(data);
      return data;
    } catch {
      return null;
    }
  }, [board.id]);
  useEffect(() => {
    setExtras(null);
    const t = setTimeout(reloadExtras, 300);
    return () => clearTimeout(t);
  }, [reloadExtras]);
  const extrasCtx = useMemo(() => ({ data: extras, reload: reloadExtras }), [extras, reloadExtras]);

  // ── Criação sem espera (formulário "Novo card") ───────────────────────────
  // O card aparece na primeira etapa assim que a gravação começa; quando o
  // servidor responde, é trocado pelo card de verdade (ou retirado, se falhar).
  const optimistic = useMemo(
    () => ({
      begin(title: string) {
        const id = `tmp-${Date.now()}`;
        const first = board.stages[0]?.id ?? "";
        setCards((prev) => {
          const top = prev.reduce((m, c) => Math.max(m, c.position), 0);
          const temp: CardView = {
            id,
            number: 0,
            title: title || "Novo card",
            stageId: first,
            position: top + 1000,
            assignee: null,
            requester: null,
            labels: [],
            dueDate: null,
            status: null,
            fields: [],
            pending: true,
          };
          return sortCards([...prev, temp]);
        });
        return id;
      },
      abort(tempId: string) {
        setCards((prev) => prev.filter((c) => c.id !== tempId));
      },
      commit(tempId: string, cardId: string) {
        loadCardPage(cardId)
          .then((data) => {
            if (!data) throw new Error("sem card");
            setCards((prev) => {
              const temp = prev.find((c) => c.id === tempId);
              const rest = prev.filter((c) => c.id !== tempId);
              // O aviso do Realtime pode já ter trazido o card: só tira o provisório.
              if (rest.some((c) => c.id === cardId) || !temp) return rest;
              const real: CardView = {
                ...temp,
                ...faceFromPage(data),
                id: cardId,
                number: data.number,
                stageId: data.stageId,
                pending: false,
                awaitingPrioritization: gated.has(data.stageId),
                prioritized: false,
              };
              return sortCards([...rest, real]);
            });
          })
          .catch(() => {
            setCards((prev) => prev.filter((c) => c.id !== tempId));
            router.refresh();
          });
        // As propriedades do card novo entram na Lista na próxima leitura.
        reloadExtras();
      },
    }),
    // `gated` muda de identidade a cada render; o conteúdo só muda com o quadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board.id, board.stages, reloadExtras, router],
  );

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
    <BoardExtrasProvider value={extrasCtx}>
    {/* No computador a PÁGINA rola (uma barra só de cada tipo), sem caixa de
        rolagem interna: o quadro cresce para o lado e para baixo, e o cabeçalho
        fica preso no topo e na esquerda. No celular a altura continua fixa. */}
    <div
      ref={shellRef}
      className={
        "flex h-[calc(100dvh-var(--bottom-nav))] flex-col md:h-auto md:min-h-dvh " +
        (view === "mine" ? "" : "md:w-max md:min-w-full")
      }
    >
      <header
        ref={headRef}
        className={
          "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 bg-[var(--background)] px-4 py-3 md:sticky md:top-0 md:z-30 md:px-6 " +
          // Só o Kanban e a Lista crescem para o lado: neles o cabeçalho tem
          // largura própria e fica preso à esquerda. Em "Minhas demandas" ele
          // simplesmente ocupa a área.
          (view === "mine" ? "" : "md:left-[var(--sidebar-w)] md:w-[var(--head-w,100%)]")
        }
      >
        <div>
          <PipelineSelector
            boards={boards}
            currentId={board.id}
            canConfigure={caps.boards}
            canManageAlcadas={caps.alcadas}
          />
          <p className="px-1.5 text-xs text-neutral-500">
            {filtering ? `${shownCards.length} de ${cards.length} cards` : `${cards.length} cards`}
            {!caps.readAll && (
              <span title="O seu papel mostra só os cards em que você é responsável ou solicitante.">
                {" "}
                · só os seus
              </span>
            )}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="relative">
            <span className="sr-only">Buscar card</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600"
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
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 hover:text-neutral-700"
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
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            title="Ver cards arquivados e reativar"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <Archive className="h-4 w-4" aria-hidden="true" /> Arquivados
          </button>
          {caps.boards && (
            <button
              type="button"
              onClick={() => setShowOptions(true)}
              title="Opções do pipeline: Minhas demandas e controle de tempo"
              aria-label="Opções do pipeline"
              className="inline-flex items-center rounded-lg border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div
            className={
              "flex rounded-lg border border-neutral-200 p-0.5 text-sm"
            }
          >
            {board.myTasks && (
              <ToggleButton active={view === "mine"} onClick={() => chooseView("mine")}>
                Minhas demandas
              </ToggleButton>
            )}
            <ToggleButton active={view === "kanban"} onClick={() => chooseView("kanban")}>
              Kanban
            </ToggleButton>
            <ToggleButton active={view === "list"} onClick={() => chooseView("list")}>
              Lista
            </ToggleButton>
          </div>
          <NewCardDialog canCreate={caps.create} optimistic={optimistic} />
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

      {isMobile === null ? (
        // Um instante até saber o tamanho da tela (evita montar o quadro errado).
        <div className="flex-1" />
      ) : view === "mine" && board.myTasks ? (
        <div className="flex-1 overflow-auto p-3 md:overflow-visible md:p-6">
          <MyTasksView
            boardId={board.id}
            cards={shownCards}
            stages={board.stages}
            myUserId={myUserId}
            timeTracking={board.timeTracking}
            onOpenCard={openCard}
          />
        </div>
      ) : isMobile && view !== "list" ? (
        <div className="min-h-0 flex-1">
          <MobileBoard
            stages={board.stages}
            cards={shownCards}
            onOpenCard={openCard}
            onAddCard={canAddInColumn ? addCard : undefined}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 md:overflow-visible md:p-6">
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
              canManage={caps.stages}
            />
          )}
        </div>
      )}

      {showOptions && (
        <BoardOptionsDialog
          boardId={board.id}
          boardName={board.name}
          myTasks={board.myTasks}
          timeTracking={board.timeTracking}
          ownPanel={board.ownPanel}
          boards={boards}
          canSyncFields={caps.fields}
          onClose={() => setShowOptions(false)}
          onSaved={() => router.refresh()}
        />
      )}

      {showArchived && (
        <ArchivedDialog
          boardId={board.id}
          boardName={board.name}
          onClose={() => setShowArchived(false)}
          onRestored={() => router.refresh()}
        />
      )}

      {selectedCardId && (
        <CardPanel
          cardId={selectedCardId}
          stageName={selectedStageName}
          myUserId={myUserId}
          onClose={closeCard}
          onSaved={cardSaved}
          stages={board.stages}
          stageId={selectedStageId}
          onMoveTo={(toStageId) => move(selectedCardId, toStageId)}
          notice={moveError}
          onDismissNotice={() => setMoveError(null)}
          onArchivedChange={(cardId, archived) => {
            if (!archived) {
              router.refresh(); // reativado: volta ao quadro com os dados completos
              return;
            }
            setCards((prev) => prev.filter((c) => c.id !== cardId));
            closeCard();
            setMoveError("Card arquivado. Para ver ou reativar, use “Arquivados” no topo do quadro.");
          }}
          onTransferred={(cardId, r) => {
            // O card saiu deste pipeline: some da lista, fecha o painel e avisa.
            setCards((prev) => prev.filter((c) => c.id !== cardId));
            closeCard();
            setMoveError(`Card enviado para “${r.boardName}” como #${r.number}. A gestão de lá define o responsável.`);
          }}
        />
      )}
    </div>
    </BoardExtrasProvider>
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
