import Link from "next/link";

import { PriorityQueue } from "@/components/prioridades/PriorityQueue";
import { SpendCharts } from "@/components/prioridades/SpendCharts";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoards } from "@/lib/board/queries";
import { loadPriorityQueue } from "@/lib/demandas/queue";
import { loadSpendData } from "@/lib/demandas/spend";

export const dynamic = "force-dynamic";

export default async function PrioridadesPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: requested } = await searchParams;
  const [actor, boards] = await Promise.all([provisionAndGetActor(), loadBoards()]);
  const active = boards.filter((b) => !b.archived);

  // Tenta o pipeline pedido; senão, o primeiro que tiver fila de demandas.
  let queue = requested ? await loadPriorityQueue(requested) : null;
  if (!queue) {
    for (const b of active) {
      queue = await loadPriorityQueue(b.id);
      if (queue) break;
    }
  }

  if (!queue) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl">Prioridades</h1>
        <p className="mt-2 text-sm text-secondary">
          Nenhum pipeline de demandas encontrado. A fila aparece em pipelines que usam o
          formulário &ldquo;Demandas de compras&rdquo;.
        </p>
      </main>
    );
  }

  const canPrioritize = actor?.permissions.has("card:update") ?? false;
  const spend = await loadSpendData(queue.boardId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm font-medium uppercase tracking-wide text-secondary">
        {queue.boardName}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl">Fila de prioridade (RICE)</h1>
        <Link
          href={{ pathname: "/prioridades/planejamento", query: { board: queue.boardId } }}
          className="text-sm text-blue-700 hover:underline"
        >
          Planejamento de gastos →
        </Link>
      </div>
      <p className="mt-2 text-sm text-secondary">
        Demandas ordenadas pelo score RICE. Priorizar registra quem decidiu e libera a demanda
        para seguir no pipeline.
      </p>

      <div className="mt-6">
        <PriorityQueue data={queue} canPrioritize={canPrioritize} />
      </div>

      {spend && (
        <section className="mt-10 border-t border-neutral-200 pt-8">
          <h2 className="text-lg">Orçamento e execução</h2>
          <p className="mt-1 max-w-3xl text-sm text-secondary">
            O mês vem da &ldquo;Data pretendida&rdquo; da demanda — é ela que diz quando o gasto
            deve acontecer.
          </p>
          <div className="mt-5">
            <SpendCharts data={spend} />
          </div>
        </section>
      )}
    </main>
  );
}
