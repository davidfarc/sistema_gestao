import { byName } from "@/lib/board/queries";
import type { StageCategory } from "@/lib/board/types";
import { createClient } from "@/lib/supabase/server";

/** Dias na mesma etapa a partir dos quais um card conta como "parado". */
export const STALLED_DAYS = 7;

export interface StageCount {
  id: string;
  name: string;
  category: StageCategory;
  wipLimit: number | null;
  cards: number;
}

export interface PipelineOverview {
  id: string;
  name: string;
  open: number;
  overdue: number;
  stalled: number;
  completedWeek: number;
  createdWeek: number;
  mine: number;
  stages: StageCount[];
}

/**
 * Resumo por pipeline para o Painel. As contas ficam no banco
 * (`report_pipeline_overview`, migration 0036) e rodam com o RLS de quem está
 * logado: cada pessoa recebe só os pipelines e cards que enxerga.
 *
 * Devolve `null` quando a função ainda não existe no banco (migration não
 * aplicada), para a tela explicar em vez de quebrar.
 */
export async function loadPipelineOverview(): Promise<PipelineOverview[] | null> {
  const db = await createClient();
  const { data, error } = await db.rpc("report_pipeline_overview", {
    p_stalled_days: STALLED_DAYS,
  });
  if (error) {
    console.error("report_pipeline_overview:", error.message);
    return null;
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data ?? []) as any[])
    .map((r) => ({
      id: r.board_id as string,
      name: r.board_name as string,
      open: Number(r.open_cards),
      overdue: Number(r.overdue),
      stalled: Number(r.stalled),
      completedWeek: Number(r.completed_week),
      createdWeek: Number(r.created_week),
      mine: Number(r.mine),
      stages: ((r.stages ?? []) as any[]).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        category: s.category as StageCategory,
        wipLimit: s.wipLimit ?? null,
        cards: Number(s.cards),
      })),
    }))
    .sort(byName);
}
