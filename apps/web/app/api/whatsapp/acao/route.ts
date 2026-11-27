import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { loadActorById } from "@/lib/actor";
import { managesBoard, moveCardAs, setResponsibleAs, surveyMove } from "@/lib/board/cardOps";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Porta interna do atendimento pelo WhatsApp (SPEC-FASE2 §C, liberação).
 *
 * O Worker `ecco-whatsapp` já reconheceu a pessoa pelo telefone cadastrado e
 * chama aqui para executar a liberação COMO ELA, pelo mesmo caminho da tela
 * (CardService.move e a atribuição de responsável). Não há sessão: quem prova
 * a origem é o segredo `WHATSAPP_SERVICE_SECRET`, igual nos dois Workers.
 *
 * Tudo é conferido de novo aqui (não se confia nos ids recebidos):
 *   - a pessoa gerencia o pipeline do card;
 *   - o card está na primeira etapa e vai para a segunda;
 *   - o responsável indicado é interno e membro do pipeline.
 */

function authorized(request: Request): boolean {
  const secret = process.env.WHATSAPP_SERVICE_SECRET ?? "";
  const given = request.headers.get("x-service-secret") ?? "";
  if (secret.length < 24 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

const no = (erro: string, status = 200) => NextResponse.json({ erro }, { status });
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function POST(request: Request) {
  if (!authorized(request)) return no("não autorizado", 401);
  let body: { userId?: unknown; acao?: unknown; cardId?: unknown; assigneeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return no("corpo inválido", 400);
  }
  if (!isId(body.userId) || !isId(body.cardId)) return no("pedido inválido", 400);

  // Pesquisa de satisfação: a secretaria acabou de confirmar o telefone (o
  // banco já conferiu e registrou); o card segue para "aguardando feedback".
  if (body.acao === "pesquisa_enviada") {
    const { data: survey } = await createAdminClient()
      .from("meeting_survey")
      .select("id")
      .eq("card_id", body.cardId)
      .eq("status", "enviada")
      .eq("confirmed_by", body.userId)
      .maybeSingle();
    if (!survey) return no("Pesquisa não encontrada.");
    const moved = await surveyMove(body.userId, body.cardId, "enviada");
    return moved.ok ? NextResponse.json({ ok: true }) : no(moved.reason);
  }

  if (body.acao !== "liberar") return no("pedido inválido", 400);
  const assigneeId = isId(body.assigneeId) ? body.assigneeId : null;

  const actor = await loadActorById(body.userId);
  if (!actor) return no("Pessoa não encontrada.");

  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("id, number, board_id, stage_id, organization_id, archived_at")
    .eq("id", body.cardId)
    .maybeSingle();
  if (!card || card.archived_at || card.organization_id !== (actor.organizationId as string)) {
    return no("Pedido não encontrado.");
  }
  if (!(await managesBoard(actor, card.board_id))) {
    return no("Só a gestão do pipeline pode liberar pedidos.");
  }

  const { data: stages } = await db.from("stage").select("id, name").eq("board_id", card.board_id).order("position").limit(2);
  const [first, second] = stages ?? [];
  if (!first || !second) return no("O pipeline precisa de pelo menos duas etapas.");
  if (card.stage_id !== first.id) return no("Este pedido já foi liberado.");

  let assigneeName: string | null = null;
  if (assigneeId) {
    if (!actor.permissions.has("card:assign")) return no("Você não tem permissão para atribuir responsável.");
    const [{ data: member }, { data: user }] = await Promise.all([
      db.from("board_member").select("user_id").eq("board_id", card.board_id).eq("user_id", assigneeId).maybeSingle(),
      db.from("app_user").select("name, email, archived_at, is_internal").eq("id", assigneeId).maybeSingle(),
    ]);
    if (!member || !user || user.archived_at || !user.is_internal) {
      return no("O responsável indicado não é da equipe deste pipeline.");
    }
    assigneeName = user.name || user.email;
  }

  const moved = await moveCardAs(actor, card.id, second.id);
  if (!moved.ok) return no(moved.reason);
  if (assigneeId) await setResponsibleAs(actor, card.id, assigneeId);

  return NextResponse.json({ ok: true, numero: Number(card.number), etapa: second.name, responsavel: assigneeName });
}
