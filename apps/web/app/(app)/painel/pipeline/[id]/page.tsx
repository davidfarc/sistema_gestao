import { notFound } from "next/navigation";

import { BoardPanelView } from "@/components/painel/BoardPanelView";
import { provisionAndGetActor } from "@/lib/actor";
import { loadBoardPanel, loadPanelBoards } from "@/lib/reports/boardPanel";

export const dynamic = "force-dynamic";

/**
 * Painel próprio de um pipeline: cards por etapa, por responsável e por cada
 * propriedade de opção; emendas e horas por opção; tempo até concluir;
 * atrasados. Cada pessoa vê só os cards que enxerga.
 */
export default async function BoardPanelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await provisionAndGetActor();
  if (!actor?.permissions.has("stage:manage")) notFound();
  const canSeeTime = actor?.permissions.has("time:read") ?? false;
  const [panel, panels] = await Promise.all([loadBoardPanel(id, canSeeTime), loadPanelBoards()]);
  if (!panel) notFound();
  return <BoardPanelView panel={panel} panels={panels} canSeeTime={canSeeTime} />;
}
