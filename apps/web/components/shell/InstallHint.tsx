"use client";

import { Share, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useInstallState } from "@/lib/pwa/installPrompt";

const DISMISS_KEY = "ecco_instalar_dispensado";

/**
 * Convite para instalar o sistema na tela inicial do celular. Some sozinho
 * quando o sistema já está instalado ou o navegador não oferece instalação.
 * `dismissible`: na tela inicial pode ser dispensado; em Avisos fica fixo,
 * porque no iPhone as notificações dependem da instalação.
 */
export function InstallHint({ dismissible = true }: { dismissible?: boolean }) {
  const state = useInstallState();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(dismissible && window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // Armazenamento bloqueado: o convite simplesmente continua aparecendo.
    }
  }, [dismissible]);

  if (!state || state.kind === "installed" || state.kind === "unavailable" || dismissed) {
    return null;
  }

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Vale só até recarregar.
    }
  }

  return (
    <section
      aria-label="Instalar o aplicativo"
      className="relative rounded-xl border border-surface-medium bg-surface-lowest p-4 shadow-premium-soft md:hidden"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 pr-8">
          <p className="text-base font-semibold text-neutral-800">Instale no seu celular</p>
          {state.kind === "prompt" ? (
            <>
              <p className="mt-1 text-sm text-neutral-600">
                O sistema ganha um ícone na tela inicial e abre em tela cheia, como um aplicativo.
              </p>
              <button
                type="button"
                onClick={() => state.install()}
                className="mt-3 min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high"
              >
                Instalar
              </button>
            </>
          ) : (
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-neutral-600">
              <li>
                No Safari, toque em{" "}
                <span className="inline-flex items-center gap-1 font-medium text-neutral-800">
                  Compartilhar <Share className="h-4 w-4" aria-hidden="true" />
                </span>
                .
              </li>
              <li>
                Escolha <span className="font-medium text-neutral-800">Adicionar à Tela de Início</span>.
              </li>
              <li>Abra o sistema pelo ícone novo. Só assim o iPhone permite notificações.</li>
            </ol>
          )}
        </div>
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dispensar"
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
