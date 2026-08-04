import { BoardView } from "@/components/board/BoardView";
import { IntakeForm } from "@/components/board/IntakeForm";
import { canManageAlcadas, provisionAndGetActor } from "@/lib/actor";
import { loadIntakeForm } from "@/lib/board/intake";
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
  // Pediu um pipeline específico e não é o que voltou? Então ele está fora do
  // alcance desta pessoa. Nunca servir outro no lugar em silêncio: a demanda
  // acabaria cadastrada no quadro errado, com a URL dizendo o contrário.
  if (boardId && board?.id !== boardId) {
    const intake = await loadIntakeForm(boardId);
    if (intake) return <IntakeForm form={intake} />;
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg">Pipeline indisponível</h1>
        <p className="mt-2 text-sm text-secondary">
          Este pipeline não existe ou você não tem acesso a ele. Peça acesso à gestão.
        </p>
      </div>
    );
  }
  if (!board) {
    return (
      <div className="p-8 text-neutral-500">
        Nenhum quadro encontrado — aplique o seed (<code>infra/apply.mjs</code>).
      </div>
    );
  }
  const caps = {
    fields: actor?.permissions.has("field:manage") ?? false,
    stages: actor?.permissions.has("stage:manage") ?? false,
    boards: actor?.permissions.has("board:configure") ?? false,
    alcadas: canManageAlcadas(actor),
    create: actor?.permissions.has("card:create") ?? false,
  };
  return (
    <BoardView
      board={board}
      boards={boards}
      caps={caps}
      myUserId={(actor?.userId as string) ?? null}
    />
  );
}
