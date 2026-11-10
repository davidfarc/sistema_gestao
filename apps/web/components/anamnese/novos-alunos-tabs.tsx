"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3, CalendarCheck, CalendarClock, CalendarDays, Cog, GraduationCap, History,
  LayoutDashboard, Link2, UserRound,
} from "lucide-react";

// Abas da seção "Novos alunos" — mesmo padrão visual das abas da Gestão de Vila.
const ICONS = {
  home: LayoutDashboard, agenda: CalendarDays, list: CalendarCheck, avail: CalendarClock, report: BarChart3,
  psy: UserRound, seg: GraduationCap, google: Link2, cfg: Cog, audit: History,
} as const;

export type TabItem = { href: string; label: string; icon: keyof typeof ICONS };

export default function NovosAlunosTabs({ items }: { items: TabItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Módulos de Novos alunos">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = href === "/novos-alunos" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-white shadow-premium-soft"
                : "border border-black/5 bg-surface-lowest text-secondary hover:text-primary",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
