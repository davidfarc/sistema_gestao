"use client";

import clsx from "clsx";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useSidebar } from "./SidebarContext";

interface MenuItem {
  Icon: LucideIcon;
  label: string;
  href: string;
  disabled?: boolean;
}

const MENU: MenuItem[] = [
  { Icon: LayoutDashboard, label: "Início", href: "/" },
  { Icon: KanbanSquare, label: "Quadro", href: "/board" },
  { Icon: Users, label: "Usuários", href: "/configuracoes/usuarios" },
];

export function Sidebar({ user }: { user: { email: string; internal: boolean } | null }) {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const showLabels = mobileOpen || !collapsed;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <>
      {/* Hambúrguer mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
        className="fixed left-3 top-3 z-[110] flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white shadow-md md:hidden"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "fixed left-0 top-0 z-[105] h-screen bg-primary text-white shadow-lg transition-[width] duration-200",
          mobileOpen ? "w-60 translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed ? "md:w-16" : "md:w-60",
        )}
      >
        {/* Toggle desktop */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className="absolute -right-3 top-6 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-primary/10 bg-white text-primary shadow-md hover:bg-primary/5 md:flex"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>

        <div className="flex h-full flex-col py-3">
          {/* Logo */}
          <div className={clsx("mb-4 flex h-9 items-center gap-2.5", showLabels ? "px-3" : "justify-center px-2")}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
              <BookOpen className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            </div>
            {showLabels && (
              <span className="font-headline text-base font-extrabold tracking-tight text-white">
                Ecco Prime
              </span>
            )}
          </div>

          {/* Nav */}
          <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Navegação">
            {MENU.map((item) => {
              const active = !item.disabled && isActive(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.disabled ? "#" : item.href}
                  title={!showLabels ? item.label : undefined}
                  aria-disabled={item.disabled}
                  className={clsx(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-white/10 font-semibold text-white"
                      : "text-white/70 hover:bg-white/5 hover:text-white",
                    item.disabled && "pointer-events-none opacity-40",
                    !showLabels && "justify-center",
                  )}
                >
                  <item.Icon
                    className={clsx("h-4 w-4 shrink-0", active && "text-tertiary-fixed")}
                    aria-hidden="true"
                  />
                  {showLabels && <span className="flex-1 truncate whitespace-nowrap">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Usuário */}
          <div className="border-t border-white/10 px-2 pt-2">
            {user ? (
              <div className={clsx("flex items-center gap-2 rounded-md p-1.5", !showLabels && "justify-center")}>
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-tertiary-fixed text-[10px] font-black text-primary"
                  title={user.email}
                >
                  {initials}
                </div>
                {showLabels && (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold" title={user.email}>
                        {user.email}
                      </p>
                      <p className="text-[10px] opacity-70">{user.internal ? "interno" : "externo"}</p>
                    </div>
                    <form action="/auth/signout" method="post">
                      <button
                        type="submit"
                        aria-label="Sair"
                        title="Sair"
                        className="shrink-0 rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </form>
                  </>
                )}
              </div>
            ) : (
              showLabels && (
                <Link
                  href="/login"
                  className="block rounded-md bg-white p-2 text-center text-xs font-bold text-primary hover:bg-white/90"
                >
                  Entrar
                </Link>
              )
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
