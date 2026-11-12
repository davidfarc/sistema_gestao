"use client";

import { useEffect } from "react";

const DIALOG = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Comportamento de teclado e foco para TODAS as janelas modais do sistema, num
 * lugar só. Basta a janela ter `role="dialog" aria-modal="true"`:
 *
 * - ao abrir, o foco entra na janela (respeita `autoFocus`);
 * - Tab e Shift+Tab ficam presos dentro dela;
 * - Esc fecha, do mesmo jeito que clicar fora (clica no fundo escuro);
 * - ao fechar, o foco volta para o botão que a abriu;
 * - se a janela não tiver nome, usa o primeiro título dentro dela.
 *
 * Ajustes por janela: `data-escape="own"` (ela trata o Esc sozinha) e
 * `data-focus="own"` (ela cuida de pôr e devolver o foco).
 */
export function DialogA11y() {
  useEffect(() => {
    const open: { el: HTMLElement; restore: HTMLElement | null }[] = [];
    // Último elemento focado FORA de qualquer janela: é para onde o foco volta.
    let lastOutside: HTMLElement | null = null;
    let labelSeq = 0;

    const visible = (el: HTMLElement) => el.getClientRects().length > 0;
    const focusables = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

    function onOpen(el: HTMLElement) {
      if (open.some((d) => d.el === el)) return;
      open.push({ el, restore: lastOutside });
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
        const heading = el.querySelector<HTMLElement>("h1, h2, h3, h4");
        if (heading) {
          heading.id ||= `dialogo-titulo-${++labelSeq}`;
          el.setAttribute("aria-labelledby", heading.id);
        }
      }
      if (el.dataset.focus === "own" || el.contains(document.activeElement)) return;
      if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }

    function onClose(el: HTMLElement) {
      const i = open.findIndex((d) => d.el === el);
      if (i < 0) return;
      const [closed] = open.splice(i, 1);
      if (el.dataset.focus === "own") return;
      const target = closed!.restore;
      if (target && target.isConnected) target.focus({ preventScroll: true });
    }

    const each = (node: Node, fn: (el: HTMLElement) => void) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(DIALOG)) fn(node);
      node.querySelectorAll<HTMLElement>(DIALOG).forEach(fn);
    };

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach((n) => each(n, onClose));
        r.addedNodes.forEach((n) => each(n, onOpen));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    each(document.body, onOpen);

    function onFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest(DIALOG)) lastOutside = target;
    }

    function onKeyDown(e: KeyboardEvent) {
      const top = open[open.length - 1]?.el;
      if (!top) return;

      if (e.key === "Escape") {
        if (e.defaultPrevented || top.dataset.escape === "own") return;
        // Mesmo caminho de "clicar fora": respeita janelas que não fecham no meio de um envio.
        const backdrop = top.parentElement;
        if (backdrop && backdrop !== document.body) {
          e.preventDefault();
          backdrop.click();
        }
        return;
      }

      if (e.key !== "Tab") return;
      const items = focusables(top);
      if (items.length === 0) {
        e.preventDefault();
        top.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !top.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === top)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
