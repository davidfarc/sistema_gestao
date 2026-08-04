"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/configuracoes/usuarios", label: "Usuários" },
  { href: "/configuracoes/papeis", label: "Papéis" },
  { href: "/configuracoes/alcadas", label: "Alçadas" },
];

export function ConfigTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-3 flex gap-1 border-b border-surface-medium" aria-label="Configurações">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-secondary hover:text-neutral-800",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
