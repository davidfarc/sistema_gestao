import { redirect } from "next/navigation";

import { BoardView } from "@/components/board/BoardView";
import { IntakeForm } from "@/components/board/IntakeForm";
import { canManageAlcadas, provisionAndGetActor } from "@/lib/actor";
import { loadIntakeForm } from "@/lib/board/intake";
import { loadBoard, loadBoards } from "@/lib/board/queries";
import { createClient } from "@/lib/supabase/server";

// Sempre lê o estado atual do banco (e reflete revalidatePath após mutações).
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; card?: string }>;
}) {
  const { board: boardParam, card: cardId } = await searchParams;
  // Link direto para um card (`/board?card=<id>`): o quadro que abre por baixo
  // é o do card. O RLS decide se a pessoa enxerga o card; se não, segue normal
  // e o painel avisa que o card está indisponível.
  let cardBoardId: string | null = null;
  if (cardId) {
    const db = await createClient();
    const { data } = await db.from("card").select("board_id").eq("id", cardId).maybeSingle();
    cardBoardId = data?.board_id ?? null;
  }
  const boardId = boardParam ?? cardBoardId ?? undefined;
  const [board, boards, actor] = await Promise.all([
    loadBoard(boardId),
    loadBoards(),
    provisionAndGetActor(),
  ]);
  // Enxerga o card mas não o quadro dele (ex.: solicitante de outra área), ou o
  // link mistura card e pipeline diferentes: abre o card em página inteira.
  if (cardId && cardBoardId && board?.id !== cardBoardId) redirect(`/card/${cardId}`);
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
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg">Nenhum pipeline por aqui</h1>
        <p className="mt-2 text-sm text-secondary">
          Você ainda não participa de nenhum pipeline. Peça à gestão para incluir você em um.
        </p>
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
