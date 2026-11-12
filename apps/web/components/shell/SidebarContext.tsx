"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface SidebarCtx {
  collapsed: boolean;
  toggle: () => void;
  /** Menu completo aberto por cima da tela, no celular (botão "Menu" da barra inferior). */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  return <Ctx.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen }}>{children}</Ctx.Provider>;
}

export const useSidebar = () => useContext(Ctx);
