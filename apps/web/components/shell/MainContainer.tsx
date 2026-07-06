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
        "min-h-screen transition-[margin] duration-200",
        collapsed ? "md:ml-16" : "md:ml-60",
      )}
    >
      {children}
    </div>
  );
}
