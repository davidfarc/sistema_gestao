import { parseThresholds, type Thresholds } from "@ecco/core";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Limites de alçada configurados para um pipeline. `{}` no banco cai nos
 * defaults do core. Deduplicado por request com `cache()` — o painel e a
 * aprovação costumam pedir os mesmos limites no mesmo render.
 */
export const loadBoardThresholds = cache(async (boardId: string): Promise<Thresholds> => {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("board")
    .select("alcada_thresholds")
    .eq("id", boardId)
    .maybeSingle();
  return parseThresholds(data?.alcada_thresholds);
});
