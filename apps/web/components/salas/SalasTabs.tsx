"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { School, Users, UserCog, CalendarDays, ClipboardList, UserSearch, type LucideIcon } from "lucide-react";

interface Tab {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const tabs: Tab[] = [
  { href: "/salas", label: "Salas", Icon: School },
  { href: "/salas/alunos", label: "Alunos", Icon: Users },
  { href: "/salas/equipe", label: "Equipe", Icon: UserCog },
  { href: "/salas/rotina", label: "Rotina", Icon: CalendarDays },
  { href: "/salas/relatorios", label: "Relatórios", Icon: ClipboardList },
  { href: "/salas/busca-ativa", label: "Busca Ativa", Icon: UserSearch },
];

export default function SalasTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Módulos da Gestão de Vila">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-white shadow-premium-soft"
                : "bg-surface-lowest text-secondary border border-black/5 hover:text-primary"
            )}
          >
            <t.Icon className="w-4 h-4" aria-hidden="true" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
