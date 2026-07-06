import { BoardView } from "@/components/board/BoardView";
import { loadBoard } from "@/lib/board/queries";

// Sempre lê o estado atual do banco (e reflete revalidatePath após mutações).
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const board = await loadBoard();
  if (!board) {
    return (
      <div className="p-8 text-neutral-500">
        Nenhum quadro encontrado — aplique o seed (<code>infra/apply.mjs</code>).
      </div>
    );
  }
  return <BoardView board={board} />;
}
