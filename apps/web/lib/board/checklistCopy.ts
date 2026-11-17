import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Fora do arquivo de Server Actions de propósito: esta função NÃO confere
// permissão, então não pode ser chamável direto pelo navegador.

/**
 * Copia os modelos para o card (um checklist por modelo, itens desmarcados).
 * Só modelos do pipeline do próprio card. Sem checagem de permissão: quem
 * chama já conferiu (edição do card ou criação pela caixa de entrada).
 */
export async function copyTemplatesToCard(cardId: string, templateIds: string[]): Promise<void> {
  const ids = [...new Set(templateIds)].slice(0, 20);
  if (ids.length === 0) return;
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("board_id, organization_id").eq("id", cardId).maybeSingle();
  if (!card) return;
  const [{ data: templates }, { data: last }] = await Promise.all([
    db.from("checklist_template").select("id, name, items").eq("board_id", card.board_id).in("id", ids),
    db.from("checklist").select("position").eq("card_id", cardId).order("position", { ascending: false }).limit(1),
  ]);
  let position = last?.[0] ? Number(last[0].position) + 1 : 0;
  // Na ordem em que a pessoa escolheu.
  for (const id of ids) {
    const tpl = (templates ?? []).find((t) => t.id === id);
    if (!tpl) continue;
    const { data: created, error } = await db
      .from("checklist")
      .insert({ organization_id: card.organization_id, card_id: cardId, name: tpl.name, position: position++ })
      .select("id")
      .single();
    if (error || !created) continue;
    const items = ((tpl.items ?? []) as string[]).map((text, i) => ({ checklist_id: created.id, text, position: i }));
    if (items.length > 0) await db.from("checklist_item").insert(items);
  }
}

