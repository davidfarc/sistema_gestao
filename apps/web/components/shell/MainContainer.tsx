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
        "min-h-dvh pb-[var(--bottom-nav)] transition-[margin] duration-200",
        collapsed ? "md:ml-16" : "md:ml-60",
      )}
    >
      {children}
    </div>
  );
}
