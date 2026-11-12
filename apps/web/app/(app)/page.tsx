import { BarChart3, KanbanSquare } from "lucide-react";
import Link from "next/link";

import { InstallHint } from "@/components/shell/InstallHint";
import { Shortcuts } from "@/components/home/Shortcuts";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoardOptions, loadShortcuts } from "@/lib/shortcuts/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [actor, shortcuts, boards] = await Promise.all([
    provisionAndGetActor(),
    loadShortcuts(),
    loadBoardOptions(),
  ]);
  const canManage = actor?.permissions.has("board:configure") ?? false;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 md:py-16">
      <div className="mb-6 empty:hidden">
        <InstallHint />
      </div>
      <h1 className="text-3xl">Sistema de Gestão Eccoprime</h1>
      <p className="mt-2 max-w-xl text-secondary">
        Quadros, conversas, painéis e os módulos da escola e da editora num só lugar.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link
          href="/board"
          className="group flex items-center gap-3 rounded-xl border border-surface-medium bg-surface-lowest p-5 shadow-premium-soft transition hover:shadow-premium-hover"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <KanbanSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base">Quadro de produção</h3>
            <p className="text-sm text-secondary">Kanban + lista, cards e checklists</p>
          </div>
        </Link>
        <Link
          href="/painel"
          className="group flex items-center gap-3 rounded-xl border border-surface-medium bg-surface-lowest p-5 shadow-premium-soft transition hover:shadow-premium-hover"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base">Painel</h3>
            <p className="text-sm text-secondary">Atrasados, parados e concluídos por pipeline</p>
          </div>
        </Link>
      </div>

      <Shortcuts shortcuts={shortcuts} boards={boards} canManage={canManage} />
    </main>
  );
}
