"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

import { useSidebar } from "./SidebarContext";

/** Área de conteúdo, deslocada pela largura da sidebar (transição suave). */
export function MainContainer({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div
      className={clsx(
        // Respiro embaixo para a barra de navegação do celular (0 no computador).
        "min-h-dvh pb-[var(--bottom-nav)] transition-[margin] duration-200 [--sidebar-w:0px]",
        // `--sidebar-w`: largura do menu, para o que precisa ficar preso na
        // tela quando a página rola de lado (cabeçalho do quadro).
        collapsed ? "md:ml-16 md:[--sidebar-w:4rem]" : "md:ml-60 md:[--sidebar-w:15rem]",
      )}
    >
      {children}
    </div>
  );
}
