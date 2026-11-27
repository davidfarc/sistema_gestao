"use server";

import { surveyMove } from "@/lib/board/cardOps";
import { createAdminClient } from "@/lib/supabase/admin";

const RESOLVIDO = ["Sim", "Em parte", "Não"] as const;

/**
 * Resposta da pesquisa de satisfação (página pública, sem login). Quem prova o
 * direito de responder é o link único (64 caracteres); o banco grava uma vez só,
 * comenta no card e o card segue para "Feedback recebido".
 */
export async function answerSurvey(
  token: string,
  nota: number,
  resolvido: string,
  comentario: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, error: "Link inválido." };
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return { ok: false, error: "Escolha uma nota de 1 a 5." };
  if (!(RESOLVIDO as readonly string[]).includes(resolvido)) return { ok: false, error: "Diga se o assunto foi resolvido." };

  const db = createAdminClient();
  const { data, error } = await db.rpc("meeting_survey_answer" as never, {
    p_token: token,
    p_answers: { nota: String(nota), resolvido, comentario: comentario.trim().slice(0, 1000) },
  } as never);
  if (error) return { ok: false, error: "Não foi possível registrar agora. Tente de novo em instantes." };
  const res = data as { ok?: boolean; erro?: string; card_id?: string; confirmed_by?: string } | null;
  if (!res?.ok) {
    return { ok: false, error: res?.erro === "já respondida" ? "Esta pesquisa já foi respondida. Obrigado!" : "Esta pesquisa não está mais aberta." };
  }
  if (res.card_id && res.confirmed_by) await surveyMove(res.confirmed_by, res.card_id, "respondida").catch(() => null);
  return { ok: true };
}
