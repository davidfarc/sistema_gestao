import { BoardView } from "@/components/board/BoardView";
import { loadBoardPage } from "@/lib/board/queries";

// Sempre lê o estado atual do banco (e reflete revalidatePath após mutações).
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const data = await loadBoardPage();
  if (!data) {
    return (
      <div className="p-8 text-neutral-500">
        Nenhum quadro encontrado — aplique o seed (<code>infra/apply.mjs</code>).
      </div>
    );
  }
  return (
    <BoardView board={data.board} materias={data.materias} series={data.series} />
  );
}
