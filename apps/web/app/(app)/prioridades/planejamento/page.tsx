import Link from "next/link";

import { PlanGrid } from "@/components/planejamento/PlanGrid";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoards } from "@/lib/board/queries";
import { loadPlanGrid } from "@/lib/planejamento/plan";

export const dynamic = "force-dynamic";

export default async function PlanejamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; ano?: string }>;
}) {
  const { board: requested, ano } = await searchParams;
  const [actor, boards] = await Promise.all([provisionAndGetActor(), loadBoards()]);

  const anoAtual = new Date().getFullYear();
  const parsed = Number(ano);
  const year = Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : anoAtual;

  // Mesma resolução de pipeline da página de prioridades: o pedido ou o primeiro
  // que tenha fila de demandas.
  let grid = requested ? await loadPlanGrid(requested, year) : null;
  if (!grid) {
    for (const b of boards.filter((x) => !x.archived)) {
      grid = await loadPlanGrid(b.id, year);
      if (grid) break;
    }
  }

  if (!grid) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl">Planejamento de gastos</h1>
        <p className="mt-2 text-sm text-secondary">
          Nenhum pipeline de demandas encontrado. O planejamento acompanha pipelines que usam o
          formulário &ldquo;Demandas de compras&rdquo;.
        </p>
      </main>
    );
  }

  const canEdit = actor?.permissions.has("plan:manage") ?? false;
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1];

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10">
      <p className="text-sm font-medium uppercase tracking-wide text-secondary">{grid.boardName}</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl">Planejamento de gastos</h1>
        <Link
          href={{ pathname: "/prioridades", query: { board: grid.boardId } }}
          className="text-sm text-blue-700 hover:underline"
        >
          ← Voltar para a fila de prioridade
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-secondary">
        Quanto se pretende gastar em cada área, mês a mês. É este número que os gráficos da fila
        usam como total — sem ele, dá para ver a divisão entre as filas, mas não quanto do orçamento
        já foi comprometido.
      </p>

      <nav className="mt-6 flex items-center gap-1" aria-label="Ano">
        {anos.map((a) => (
          <Link
            key={a}
            href={{ pathname: "/prioridades/planejamento", query: { board: grid.boardId, ano: a } }}
            className={
              a === year
                ? "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            }
          >
            {a}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        <PlanGrid grid={grid} canEdit={canEdit} />
      </div>
    </main>
  );
}
