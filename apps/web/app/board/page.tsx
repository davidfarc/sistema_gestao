import { BoardView } from "@/components/board/BoardView";
import { MOCK_BOARD } from "@/lib/board/mock";

// Quadro com dados de demonstração. Quando plugarmos o banco, este page vira um
// Server Component que carrega o board real (atrás de auth) e mapeia p/ CardView.
export default function BoardPage() {
  return <BoardView board={MOCK_BOARD} />;
}
