import "server-only";

import {
  CardService,
  ForbiddenError,
  GateBlockedError,
  firstPosition,
  placeInColumn,
  positionAfter,
  type Actor,
  type Placement,
  type RuleViolation,
} from "@ecco/core";

import { loadActorById } from "@/lib/actor";
import { createSupabaseMovePort } from "@/lib/board/cardMoveAdapter";
import { ensureDmChannel } from "@/lib/comms/dm";
import { sendPush } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopTimersOnCard } from "@/lib/time/stop";

/**
 * Operações de card que recebem o ATOR pronto. Ficam fora do arquivo de
 * actions ("use server") de propósito: ali toda função exportada vira endpoint
 * chamável pelo navegador, e estas confiam em quem as chama para ter
 * identificado a pessoa e conferido o alcance (a tela, pela sessão; o
 * atendimento pelo WhatsApp, pela rota interna com segredo).
 */

type AdminDb = ReturnType<typeof createAdminClient>;

/** Registra uma atividade no card (feed estilo Trello). */
export async function recordActivity(
  cardId: string,
  actorId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return;
  await db.from("activity").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    actor_id: actorId,
    kind,
    payload,
  });
}

/** Posição para um card entrar no FIM da etapa (card novo vai para o pé da coluna). */
export async function endOfStagePosition(db: AdminDb, stageId: string): Promise<number> {
  const { data } = await db
    .from("card")
    .select("position")
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? positionAfter(Number(data.position)) : firstPosition();
}

/**
 * Grava a ordem do card dentro da etapa em que ele JÁ está (a troca de etapa é
 * sempre do CardService.move). Sem `placement`, vai para o fim da coluna.
 */
export async function placeCardInStage(
  db: AdminDb,
  cardId: string,
  stageId: string,
  placement: Placement | undefined,
): Promise<void> {
  if (!placement) {
    const { error } = await db
      .from("card")
      .update({ position: await endOfStagePosition(db, stageId) })
      .eq("id", cardId)
      .eq("stage_id", stageId);
    if (error) throw new Error(error.message);
    return;
  }
  // Mesma ordem que o quadro mostra (loadBoard): posição e, no empate, número.
  const { data: column, error: readError } = await db
    .from("card")
    .select("id, position")
    .eq("stage_id", stageId)
    .order("position")
    .order("number");
  if (readError) throw new Error(readError.message);

  const current = (column ?? []).map((c) => ({ id: c.id, position: Number(c.position) }));
  const result = placeInColumn(current, cardId, placement);
  const writes =
    result.kind === "single"
      ? [{ id: cardId, position: result.position }]
      : result.positions.filter(
          (p) => current.find((c) => c.id === p.id)?.position !== p.position,
        );
  const results = await Promise.all(
    writes.map((w) =>
      db.from("card").update({ position: w.position }).eq("id", w.id).eq("stage_id", stageId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/** Insere o card no fim da etapa e registra `card_created`. Sem checagens: é de quem chama. */
/**
 * A pessoa gerencia este pipeline? Vale `stage:manage` + enxergar o pipeline:
 * Gestor e Gestor Master (todos) ou Gestor de área que é membro dele.
 */
export async function managesBoard(actor: Actor, boardId: string): Promise<boolean> {
  if (!actor.isInternal || !actor.permissions.has("stage:manage")) return false;
  if (actor.permissions.has("board:configure")) return true;
  const { data } = await createAdminClient()
    .from("board_member")
    .select("board_id")
    .eq("board_id", boardId)
    .eq("user_id", actor.userId as string)
    .maybeSingle();
  return !!data;
}

/**
 * Liberação pela gestão (opção do pipeline, migration 0052): o pedido nasce na
 * primeira etapa e só sai dela pelas mãos de quem gerencia o pipeline.
 * Devolve o motivo do bloqueio, ou null se pode seguir.
 */
async function releaseBlock(actor: Actor, cardId: string, toStageId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("board_id, stage_id").eq("id", cardId).maybeSingle();
  if (!card || card.stage_id === toStageId) return null;
  // Antes da migration a coluna não existe: a consulta falha e nada é bloqueado.
  const { data: board } = await db.from("board").select("release_required").eq("id", card.board_id).maybeSingle();
  if ((board as { release_required?: boolean } | null)?.release_required !== true) return null;
  const { data: first } = await db
    .from("stage")
    .select("id")
    .eq("board_id", card.board_id)
    .order("position")
    .limit(1)
    .maybeSingle();
  if (!first || first.id !== card.stage_id) return null;
  if (await managesBoard(actor, card.board_id)) return null;
  return "Este pedido aguarda a liberação da gestão do pipeline.";
}

/**
 * Quem pode mudar o card de etapa: a gestão do pipeline (Gestor, Gestor Master
 * e o Gestor de área dele) ou o RESPONSÁVEL pela demanda. Membro interno que
 * não é o responsável vê o card, mas não o tira da coluna. Reordenar dentro da
 * mesma etapa não passa por aqui. Devolve o motivo do bloqueio, ou null.
 */
async function responsibleBlock(actor: Actor, cardId: string, toStageId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("board_id, stage_id").eq("id", cardId).maybeSingle();
  if (!card || card.stage_id === toStageId) return null;
  if (await managesBoard(actor, card.board_id)) return null;
  const { data: mine } = await db
    .from("assignment")
    .select("user_id")
    .eq("card_id", cardId)
    .eq("user_id", actor.userId as string)
    .is("stage_id", null)
    .maybeSingle();
  if (mine) return null;
  return "Só o responsável pela demanda ou a gestão do pipeline pode mudar o card de etapa.";
}

/**
 * Movimento do fluxo da pesquisa de satisfação (migration 0062): só as duas
 * passagens que a configuração do pipeline autoriza — da etapa que dispara para
 * "aguardando" (a secretaria confirmou o telefone) e de "aguardando" para
 * "recebido" (o participante respondeu). Passa pelo CardService como quem
 * confirmou o telefone, sem exigir que seja o responsável pelo card.
 */
export async function surveyMove(
  userId: string,
  cardId: string,
  step: "enviada" | "respondida",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("board_id, stage_id").eq("id", cardId).maybeSingle();
  if (!card) return { ok: false, reason: "Card não encontrado." };
  const { data: board } = await db.from("board").select("survey_config").eq("id", card.board_id).maybeSingle();
  const cfg = (board as { survey_config?: Record<string, unknown> | null } | null)?.survey_config ?? null;
  if (!cfg || cfg.enabled !== true) return { ok: false, reason: "Pesquisa desligada neste pipeline." };
  const from = step === "enviada" ? cfg.trigger_stage_id : cfg.waiting_stage_id;
  const to = step === "enviada" ? cfg.waiting_stage_id : cfg.done_stage_id;
  if (typeof to !== "string" || !to) return { ok: false, reason: "Etapa da pesquisa não configurada." };
  // O card já saiu da etapa esperada (alguém moveu à mão): não mexe.
  if (card.stage_id !== from) return { ok: true };
  const person = await loadActorById(userId);
  if (!person) return { ok: false, reason: "Pessoa não encontrada." };
  const actor: Actor = { ...person, permissions: new Set([...person.permissions, "card:move"]) };
  const service = new CardService(createSupabaseMovePort(), () => new Date().toISOString());
  try {
    const res = await service.move(actor, cardId, to);
    if (res.moved) {
      await recordActivity(cardId, actor.userId, "card_moved", { toStageId: to, fromStageId: from, via: "pesquisa" });
      await placeCardInStage(db, cardId, to, undefined);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof GateBlockedError) {
      const violations = (e.details ?? []) as RuleViolation[];
      return { ok: false, reason: violations[0]?.message ?? "Transição bloqueada." };
    }
    throw e;
  }
}

/** Move o card pelo CardService (regras de fluxo, histórico, cronômetro, ordem). */
export async function moveCardAs(
  actor: Actor,
  cardId: string,
  toStageId: string,
  placement?: Placement,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const blocked = (await releaseBlock(actor, cardId, toStageId)) ?? (await responsibleBlock(actor, cardId, toStageId));
  if (blocked) return { ok: false, reason: blocked };

  const service = new CardService(createSupabaseMovePort(), () => new Date().toISOString());
  // Etapa de origem e tempo de permanência: lidos ANTES do movimento, porque o
  // `applyMove` sobrescreve `stage_entered_at`. Base dos relatórios por etapa.
  const { data: before } = await createAdminClient()
    .from("card")
    .select("stage_id, stage_entered_at")
    .eq("id", cardId)
    .maybeSingle();
  try {
    const res = await service.move(actor, cardId, toStageId);
    if (res.moved) {
      await recordActivity(cardId, actor.userId, "card_moved", {
        toStageId,
        fromStageId: before?.stage_id ?? null,
        secondsInStage: before?.stage_entered_at
          ? Math.max(0, Math.round((Date.now() - new Date(before.stage_entered_at).getTime()) / 1000))
          : null,
      });
    }
    // Foi para revisão ou concluído: o trabalho ativo parou, pausa o cronômetro.
    if (res.moved) {
      const { data: stage } = await createAdminClient()
        .from("stage")
        .select("category")
        .eq("id", toStageId)
        .maybeSingle();
      if (stage?.category === "review" || stage?.category === "done") await stopTimersOnCard(cardId);
    }
    // Trocou de etapa sem dizer onde (ex.: pela Lista) → fim da coluna.
    if (res.moved || placement) {
      await placeCardInStage(
        createAdminClient(),
        cardId,
        toStageId,
        placement && {
          beforeId: typeof placement.beforeId === "string" ? placement.beforeId : null,
          afterId: typeof placement.afterId === "string" ? placement.afterId : null,
        },
      );
    }
      return { ok: true };
  } catch (e) {
    if (e instanceof GateBlockedError) {
      const violations = (e.details ?? []) as RuleViolation[];
      return { ok: false, reason: violations[0]?.message ?? "Transição bloqueada." };
    }
    if (e instanceof ForbiddenError) {
      return { ok: false, reason: "Você não tem permissão para mover cards." };
    }
    throw e;
  }
}

/**
 * Define o responsável do card (único). `userId` null = remove. Registra no
 * histórico e avisa quem foi atribuído (sininho, Conversas e push).
 */
export async function setResponsibleAs(actor: Actor, cardId: string, userId: string | null): Promise<void> {
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id, number, title, board_id")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card não encontrado.");

  // Um responsável por card: limpa qualquer assignment e recria se houver.
  await db.from("assignment").delete().eq("card_id", cardId);
  if (userId) {
    const { error } = await db.from("assignment").insert({
      organization_id: card.organization_id,
      card_id: cardId,
      stage_id: null,
      user_id: userId,
    });
    if (error) throw new Error(error.message);
    await recordActivity(cardId, actor.userId, "assignment_changed", { userId });

    // Notifica quem foi atribuído (exceto se atribuiu a si mesmo).
    if (userId !== (actor.userId as string)) {
      const [{ data: meU }, { data: board }] = await Promise.all([
        db.from("app_user").select("name, email").eq("id", actor.userId as string).maybeSingle(),
        db.from("board").select("name").eq("id", card.board_id).maybeSingle(),
      ]);
      const boardName = board?.name ?? "";
      await db.from("notification").insert({
        organization_id: card.organization_id,
        user_id: userId,
        kind: "assignment",
        payload: {
          actorName: meU?.name || meU?.email || "Alguém",
          cardNumber: card.number,
          cardTitle: card.title,
          boardName,
        },
      });
      // Também nas Conversas (mensagem direta de quem atribuiu), com o link
      // "Abrir o card" — o mesmo caminho do aviso de menção.
      try {
        const channelId = await ensureDmChannel(db, card.organization_id, actor.userId as string, userId);
        await db.from("message").insert({
          organization_id: card.organization_id,
          channel_id: channelId,
          author_id: actor.userId,
          body: `📌 atribuiu você como responsável pelo card #${card.number} «${card.title}»${boardName ? ` · ${boardName}` : ""}\n/board?card=${cardId}`,
          mentions: [],
        });
      } catch {
        // O aviso do sininho e o push já foram; a mensagem é um reforço.
      }
      await sendPush([userId], {
        title: `${meU?.name || meU?.email || "Alguém"} atribuiu um card a você`,
        body: `#${card.number} ${card.title}`,
        url: `/board?card=${cardId}`,
        tag: `card-${cardId}`,
      });
    }
  }
}
