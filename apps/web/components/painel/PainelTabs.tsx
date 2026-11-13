import Link from "next/link";

/** Abas dos painéis. "Tempo" só aparece para quem tem `time:read`. */
export function PainelTabs({ current, showTime }: { current: "geral" | "tempo"; showTime: boolean }) {
  if (!showTime) return null;
  const tab = (id: "geral" | "tempo", href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === id ? "page" : undefined}
      className={
        "-mb-px border-b-2 px-3 py-2 text-sm " +
        (current === id ? "border-primary font-semibold text-primary" : "border-transparent text-neutral-600 hover:text-neutral-900")
      }
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Painéis" className="mt-4 flex gap-1 border-b border-neutral-200">
      {tab("geral", "/painel", "Visão geral")}
      {tab("tempo", "/painel/tempo", "Tempo por tarefa")}
    </nav>
  );
}
