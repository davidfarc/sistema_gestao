"use client";

import { Check, Link2, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadCardPage } from "@/lib/board/actions";
import type { CardPageData, StageView } from "@/lib/board/types";
import { useIsMobile } from "@/lib/useIsMobile";
import { CardContent } from "./CardContent";

/**
 * Card aberto por cima do quadro (`?card=<id>`): painel lateral largo no
 * computador, tela cheia no celular. O miolo é o `CardContent`, o mesmo da
 * página `/card/[id]`.
 */
export function CardPanel({
  cardId,
  stageName,
  myUserId = null,
  onClose,
  onSaved,
  stages,
  stageId,
  onMoveTo,
  notice = null,
  onDismissNotice,
}: {
  cardId: string;
  /** Etapa atual segundo o quadro (mais fresca que a carregada com o card). */
  stageName?: string;
  myUserId?: string | null;
  onClose: () => void;
  /** Etapas do quadro + etapa atual: habilitam o "Mover para…" no topo do card. */
  stages?: StageView[];
  stageId?: string;
  onMoveTo?: (stageId: string) => void;
  /** Aviso do quadro (ex.: regra de fluxo barrou o movimento), mostrado aqui porque o painel cobre o quadro. */
  notice?: string | null;
  onDismissNotice?: () => void;
  /** Algo no card foi gravado: recebe o card já relido, para o quadro refletir. */
  onSaved?: (data: CardPageData) => void;
}) {
  // undefined = carregando · null = não existe ou sem acesso
  const [data, setData] = useState<CardPageData | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Celular: o campo de comentário fica num rodapé fixo do painel.
  const isMobile = useIsMobile();
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null);
  const canMove = !!(stages && stageId && onMoveTo && stages.some((s) => s.id === stageId));

  useEffect(() => {
    let active = true;
    setData(undefined);
    loadCardPage(cardId)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [cardId]);

  const reload = useCallback(() => {
    // Uma ida ao servidor, só deste card — o quadro não é recarregado.
    loadCardPage(cardId).then((d) => {
      if (!d) return;
      setData(d);
      onSaved?.(d);
    });
  }, [cardId, onSaved]);

  // Foco entra no painel ao abrir e volta para onde estava ao fechar.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Esc: primeiro sai do campo em edição (o que grava o texto); só então fecha.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const editing =
        el &&
        el !== panelRef.current &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (editing) {
        el.blur();
        panelRef.current?.focus();
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/board?card=${cardId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o endereço da barra já serve.
    }
  }

  const iconBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 md:h-9 md:w-9";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        // Esc e foco são tratados aqui mesmo (ver efeitos acima); o DialogA11y só prende o Tab.
        data-escape="own"
        data-focus="own"
        aria-label={data ? `Card #${data.number}: ${data.title}` : "Card"}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-dvh w-full flex-col bg-white shadow-2xl outline-none md:w-[min(64rem,calc(100vw-4rem))]"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-neutral-500">
            {data && <span className="font-medium">#{data.number}</span>}
            {data && canMove ? (
              // Seletor nativo: no celular abre a lista do próprio sistema, e é
              // o jeito de mover um card sem arrastar (toque ou teclado).
              <label className="flex min-w-0 items-center gap-1.5">
                <span className="hidden shrink-0 text-xs sm:inline">Mover para</span>
                <span className="sr-only sm:hidden">Mover para a etapa</span>
                <select
                  value={stageId}
                  onChange={(e) => onMoveTo!(e.target.value)}
                  title="Mover para outra etapa"
                  className="min-h-9 min-w-0 max-w-[12rem] truncate rounded-lg border border-neutral-300 bg-white px-2 text-sm text-neutral-800 outline-none focus:border-neutral-500"
                >
                  {stages!.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              data &&
              (stageName || data.stageName) && (
                <span className="truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                  {stageName || data.stageName}
                </span>
              )
            )}
            {data === undefined && <span className="italic">carregando…</span>}
          </div>
          <button type="button" onClick={copyLink} className={iconBtn} title="Copiar link do card">
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{copied ? "Link copiado" : "Copiar link do card"}</span>
          </button>
          <Link href={`/card/${cardId}`} className={iconBtn} title="Abrir em página inteira">
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Abrir em página inteira</span>
          </Link>
          <button type="button" onClick={onClose} className={iconBtn} title="Fechar (Esc)">
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Fechar</span>
          </button>
        </div>

        {notice && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6"
          >
            <span className="flex-1">{notice}</span>
            {onDismissNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label="Fechar aviso"
                className="-my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-amber-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {data === undefined && (
            <div className="grid gap-4" aria-hidden="true">
              <div className="h-8 w-2/3 animate-pulse rounded bg-neutral-100" />
              <div className="h-32 animate-pulse rounded-lg bg-neutral-100" />
              <div className="h-20 animate-pulse rounded-lg bg-neutral-100" />
            </div>
          )}
          {data === null && (
            <div className="mx-auto max-w-sm py-16 text-center">
              <p className="text-lg text-neutral-800">Card indisponível</p>
              <p className="mt-2 text-sm text-neutral-500">
                Este card não existe mais ou você não tem acesso a ele.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high"
              >
                Voltar ao quadro
              </button>
            </div>
          )}
          {data && (
            <CardContent
              key={data.id}
              data={data}
              myUserId={myUserId}
              onChanged={reload}
              split="xl"
              composerSlot={isMobile ? composerSlot : null}
            />
          )}
        </div>

        {/* Rodapé fixo do celular: recebe o campo de comentário (portal do Comments). */}
        {isMobile && data && (
          <div
            ref={setComposerSlot}
            className="shrink-0 border-t border-neutral-200 bg-white px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          />
        )}
      </div>
    </div>
  );
}
