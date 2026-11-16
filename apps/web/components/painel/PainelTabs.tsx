import Link from "next/link";

/**
 * Abas dos painéis: "Visão geral", um painel por pipeline que tem painel
 * próprio, e "Tempo por tarefa" (só para quem tem `time:read`).
 * `current`: "geral", "tempo" ou o id do pipeline.
 */
export function PainelTabs({
  current,
  showTime,
  panels = [],
}: {
  current: string;
  showTime: boolean;
  panels?: { id: string; name: string }[];
}) {
  if (!showTime && panels.length === 0) return null;
  const tab = (id: string, href: string, label: string) => (
    <Link
      key={id}
      href={href}
      aria-current={current === id ? "page" : undefined}
      className={
        "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm " +
        (current === id ? "border-primary font-semibold text-primary" : "border-transparent text-neutral-600 hover:text-neutral-900")
      }
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Painéis" className="mt-4 flex gap-1 overflow-x-auto border-b border-neutral-200">
      {tab("geral", "/painel", "Visão geral")}
      {panels.map((p) => tab(p.id, `/painel/pipeline/${p.id}`, p.name))}
      {showTime && tab("tempo", "/painel/tempo", "Tempo por tarefa")}
    </nav>
  );
}
