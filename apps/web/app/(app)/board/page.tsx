import { BoardView } from "@/components/board/BoardView";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoard, loadBoards } from "@/lib/board/queries";

// Sempre lê o estado atual do banco (e reflete revalidatePath após mutações).
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board: boardId } = await searchParams;
  const [board, boards, actor] = await Promise.all([
    loadBoard(boardId),
    loadBoards(),
    provisionAndGetActor(),
  ]);
  if (!board) {
    return (
      <div className="p-8 text-neutral-500">
        Nenhum quadro encontrado — aplique o seed (<code>infra/apply.mjs</code>).
      </div>
    );
  }
  const canConfigure = actor?.permissions.has("board:configure") ?? false;
  return <BoardView board={board} boards={boards} canConfigure={canConfigure} />;
}
