import { BoardView } from "@/components/board/BoardView";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoard } from "@/lib/board/queries";

// Sempre lê o estado atual do banco (e reflete revalidatePath após mutações).
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [board, actor] = await Promise.all([loadBoard(), provisionAndGetActor()]);
  if (!board) {
    return (
      <div className="p-8 text-neutral-500">
        Nenhum quadro encontrado — aplique o seed (<code>infra/apply.mjs</code>).
      </div>
    );
  }
  const canConfigure = actor?.permissions.has("board:configure") ?? false;
  return <BoardView board={board} canConfigure={canConfigure} />;
}
