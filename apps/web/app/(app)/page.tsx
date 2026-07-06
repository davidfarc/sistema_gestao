import { KanbanSquare } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10 md:py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-secondary">
        Editora Ecco Prime
      </p>
      <h1 className="mt-1 text-3xl">Sistema de Gestão Editorial</h1>
      <p className="mt-2 max-w-xl text-secondary">
        Acompanhe a produção do material didático pelo pipeline editorial — do briefing à
        gráfica.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/board"
          className="group rounded-xl border border-surface-medium bg-surface-lowest p-5 shadow-premium-soft transition hover:shadow-premium-hover"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-white">
              <KanbanSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base">Quadro de produção</h3>
              <p className="text-sm text-secondary">Kanban + lista, cards e checklists</p>
            </div>
          </div>
        </Link>

        <div className="rounded-xl border border-dashed border-surface-medium p-5">
          <h3 className="text-base text-secondary">Relatórios</h3>
          <p className="mt-1 text-sm text-secondary">Em breve</p>
        </div>
      </div>
    </main>
  );
}
