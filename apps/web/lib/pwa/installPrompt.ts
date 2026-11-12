"use client";

import { useEffect, useState } from "react";

/**
 * Instalação do aplicativo (PWA).
 *
 * No Android/Chrome o navegador avisa que o site pode ser instalado com o
 * evento `beforeinstallprompt`, que pode chegar antes de a tela que mostra o
 * botão existir. Por isso ele é guardado aqui, assim que este módulo carrega
 * (a barra inferior o importa em todas as telas).
 * No iPhone não existe esse evento: a instalação é manual, pelo "Compartilhar".
 */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // nós mostramos o convite, na hora certa
    deferred = e as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

export type InstallState =
  | { kind: "installed" } // já aberto como aplicativo
  | { kind: "prompt"; install: () => Promise<void> } // Android/Chrome: botão instala
  | { kind: "ios" } // iPhone/iPad: passo a passo manual
  | { kind: "unavailable" }; // navegador não oferece instalação

export function useInstallState(): InstallState | null {
  // null até montar no navegador (evita diferença entre servidor e cliente).
  const [state, setState] = useState<InstallState | null>(null);

  useEffect(() => {
    function compute(): InstallState {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (standalone) return { kind: "installed" };
      if (deferred) {
        const event = deferred;
        return {
          kind: "prompt",
          install: async () => {
            await event.prompt();
            await event.userChoice;
            deferred = null;
            listeners.forEach((fn) => fn());
          },
        };
      }
      const ua = navigator.userAgent;
      // iPadOS se apresenta como Mac; o toque denuncia.
      const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      return ios ? { kind: "ios" } : { kind: "unavailable" };
    }
    const update = () => setState(compute());
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  return state;
}
