"use client";

import { Check, Link2, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadCardPage } from "@/lib/board/actions";
import type { CardPageData } from "@/lib/board/types";
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
  onChanged,
}: {
  cardId: string;
  /** Etapa atual segundo o quadro (mais fresca que a carregada com o card). */
  stageName?: string;
  myUserId?: string | null;
  onClose: () => void;
  /** Avisa o quadro de que algo no card foi gravado. */
  onChanged?: () => void;
}) {
  // undefined = carregando · null = não existe ou sem acesso
  const [data, setData] = useState<CardPageData | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    loadCardPage(cardId).then((d) => d && setData(d));
    onChanged?.();
  }, [cardId, onChanged]);

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
    "inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `Card #${data.number}: ${data.title}` : "Card"}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-dvh w-full flex-col bg-white shadow-2xl outline-none md:w-[min(64rem,calc(100vw-4rem))]"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-neutral-500">
            {data && <span className="font-medium">#{data.number}</span>}
            {data && (stageName || data.stageName) && (
              <span className="truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                {stageName || data.stageName}
              </span>
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

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
