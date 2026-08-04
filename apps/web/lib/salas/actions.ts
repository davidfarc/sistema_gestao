"use server";

import { requireActor } from "@/lib/actor";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Estado do módulo Vila. Guardado como um documento jsonb que preserva a forma
 * herdada do RTDB — por isso as telas e o modo Simulado continuam iguais.
 */
export async function loadSalasState(): Promise<Record<string, unknown> | null> {
  const su = await getSessionUser();
  if (!su) return null;
  const db = await createClient(); // sessão → RLS (só interno da org)
  const { data } = await db.from("sala_state").select("state").maybeSingle();
  return (data?.state as Record<string, unknown>) ?? {};
}

/**
 * Grava UM caminho do estado ("students/12/name"). Granular de propósito: dois
 * usuários mexendo em registros diferentes não se sobrescrevem. `value` nulo
 * remove o caminho (mesma semântica do RTDB).
 */
export async function salasWrite(
  path: string,
  value: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `salas:manage`, e não "é interno": editar a Vila é atribuição de quem
  // coordena, não de qualquer pessoa da equipe. Quem não a tem continua vendo
  // o módulo e usando o Simulado, que não persiste nada.
  const actor = await requireActor("salas:manage");
  if (!actor.isInternal) return { ok: false, error: "Sem permissão." };

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Caminho vazio." };

  const db = createAdminClient();
  const { error } = await db.rpc("sala_state_set", {
    p_org: actor.organizationId as string,
    p_path: parts,
    p_value: value === undefined ? null : value,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
