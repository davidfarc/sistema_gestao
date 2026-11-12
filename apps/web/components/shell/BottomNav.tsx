"use client";

import clsx from "clsx";
import {
  Bell,
  KanbanSquare,
  LayoutDashboard,
  Menu as MenuIcon,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Importado aqui para o convite de instalação ser capturado em qualquer tela.
import "@/lib/pwa/installPrompt";
import { notificationUnreadCount } from "@/lib/notifications/actions";
import { createClient } from "@/lib/supabase/client";
import { useSidebar } from "./SidebarContext";
import { useUnreadTotal } from "./UnreadBadge";

const ITEMS: { Icon: LucideIcon; label: string; href: string; match: string[] }[] = [
  { Icon: LayoutDashboard, label: "Início", href: "/", match: [] },
  { Icon: KanbanSquare, label: "Quadros", href: "/board", match: ["/board", "/card", "/prioridades"] },
  { Icon: MessagesSquare, label: "Conversas", href: "/canais", match: ["/canais"] },
  { Icon: Bell, label: "Avisos", href: "/avisos", match: ["/avisos"] },
];

/** Só monta os contadores no celular: no computador quem os mostra é a barra lateral. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

function Count({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span
      aria-label={`${n} ${label}`}
      className="absolute left-1/2 top-1 ml-1.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function ConversasCount() {
  return <Count n={useUnreadTotal("bottomnav-unread")} label="mensagens não lidas" />;
}

function AvisosCount({ pathname }: { pathname: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let active = true;
    const refetch = () => notificationUnreadCount().then((c) => active && setN(c));
    refetch();
    const supabase = createClient();
    const channel = supabase
      .channel("bottomnav-notification")
      .on("postgres_changes", { event: "*", schema: "public", table: "notification" }, refetch)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
    // Refaz ao trocar de tela: abrir Avisos marca tudo como lido.
  }, [pathname]);
  return <Count n={pathname.startsWith("/avisos") ? 0 : n} label="avisos não lidos" />;
}

/**
 * Navegação do celular: barra fixa embaixo, no alcance do polegar. O botão
 * "Menu" abre a barra lateral completa (demais módulos, configurações, sair).
 * No computador não aparece: lá a barra lateral fica sempre visível.
 */
export function BottomNav() {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();

  const item =
    "relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium";

  return (
    <nav
      aria-label="Navegação principal"
      // Altura = --bottom-nav (globals.css), a mesma que as telas descontam.
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--bottom-nav)] border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map(({ Icon, label, href, match }) => {
        const active =
          href === "/" ? pathname === "/" : match.some((m) => pathname.startsWith(m));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(item, active ? "text-primary" : "text-neutral-600")}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
            {label}
            {mobile && href === "/canais" && <ConversasCount />}
            {mobile && href === "/avisos" && <AvisosCount pathname={pathname} />}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        className={clsx(item, "text-neutral-600")}
      >
        <MenuIcon className="h-5 w-5" aria-hidden="true" />
        Menu
      </button>
    </nav>
  );
}
