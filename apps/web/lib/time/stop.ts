import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pausa qualquer cronômetro ligado neste card (de qualquer pessoa). Usado quando
 * o card sai do trabalho ativo: vai para revisão ou concluído, é arquivado ou
 * enviado a outro pipeline. Nunca lança: o tempo é secundário à ação principal.
 */
export async function stopTimersOnCard(cardId: string): Promise<void> {
  try {
    await createAdminClient()
      .from("time_entry")
      .update({ ended_at: new Date().toISOString() })
      .eq("card_id", cardId)
      .is("ended_at", null);
  } catch (e) {
    console.error("stopTimersOnCard:", e instanceof Error ? e.message : e);
  }
}
