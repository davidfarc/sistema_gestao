"use server";

import {
  CardService,
  ForbiddenError,
  GateBlockedError,
  firstPosition,
  formatPhone,
  placeInColumn,
  planFieldSync,
  positionAfter,
  validateThresholds,
  type Action,
  type Actor,
  type SyncField,
  type Placement,
  type RuleViolation,
  type Thresholds,
} from "@ecco/core";
import { BOARD_TEMPLATES, templateOptions } from "./templates";
import { copyTemplatesToCard } from "./checklistCopy";
import {
  assertAttachmentScope,
  assertBoardScope,
  assertCardScope,
  assertChecklistItemScope,
  assertChecklistScope,
  assertFieldScope,
  assertStageScope,
} from "./scope";
import { revalidatePath } from "next/cache";

import { provisionAndGetActor, requireActor, requireAlcadaManager } from "@/lib/actor";
import { getSessionUser, isInternalEmail } from "@/lib/auth";
import { createSupabaseMovePort } from "@/lib/board/cardMoveAdapter";
import { assertCanCreateInBoard } from "@/lib/board/intake";
import { parseIntake } from "@/lib/board/types";
import { ACOES_DE_GESTAO, ehPapelAdministrativo } from "@/lib/roles/catalog";
import { ensureDmChannel } from "@/lib/comms/dm";
import { sendPush } from "@/lib/push/send";
import { stopTimersOnCard } from "@/lib/time/stop";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  ActivityView,
  AttachmentView,
  CardDetailData,
  ArchivedCard,
  CardPageData,
  ChecklistItemView,
  CreatedCard,
  ChecklistView,
  CommentView,
  FieldDef,
  FieldType,
  FieldValueRaw,
  Intake,
  MemberOption,
  RoleOption,
  UserRow,
} from "@/lib/board/types";

/** Registra uma atividade no card (feed estilo Trello). */
async function recordActivity(
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

// ── Cards ────────────────────────────────────────────────────────────────────
//
// As actions de card do dia a dia (mover, renomear, responsável, propriedade,
// criar na coluna) NÃO chamam `revalidatePath("/board")`: isso faria o Next
// refazer todas as consultas do quadro a cada clique. A tela aplica a mudança
// localmente e o Realtime leva para as outras pessoas (SPEC-FASE2 A9).

type AdminDb = ReturnType<typeof createAdminClient>;

/** Posição para um card entrar no FIM da etapa (card novo vai para o pé da coluna). */
async function endOfStagePosition(db: AdminDb, stageId: string): Promise<number> {
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
async function placeCardInStage(
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
async function insertCard(
  db: AdminDb,
  actorId: string,
  board: { id: string; organization_id: string },
  stageId: string,
  title: string,
): Promise<{ id: string; number: number; title: string; position: number }> {
  const position = await endOfStagePosition(db, stageId);
  const { data: card, error } = await db
    .from("card")
    .insert({
      organization_id: board.organization_id,
      board_id: board.id,
      stage_id: stageId,
      title: title.trim() || "Novo card",
      position,
      requester_id: actorId, // solicitante = quem abriu
    })
    .select("id, number, title")
    .single();
  if (error || !card) throw new Error(error?.message ?? "Falha ao criar o card.");
  await recordActivity(card.id, actorId, "card_created", { stageId });
  return { id: card.id, number: Number(card.number), title: card.title, position };
}

/** Pipeline + primeira etapa, para as actions de criação. */
async function boardAndFirstStage(db: AdminDb, boardId: string) {
  const { data: board } = await db
    .from("board")
    .select("id, organization_id, creation_form")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) throw new Error("Pipeline não encontrado.");
  const { data: firstStage } = await db
    .from("stage")
    .select("id")
    .eq("board_id", board.id)
    .order("position")
    .limit(1)
    .maybeSingle();
  if (!firstStage) throw new Error("Pipeline sem etapas. Adicione uma coluna antes.");
  return { board, firstStageId: firstStage.id as string };
}

/** Cria um card na 1ª etapa só com o nome. O #number vem por trigger no banco. */
export async function createCard(
  boardId: string,
  title: string,
  /** Modelos de checklist do pipeline com que o card já nasce (opcional). */
  templateIds: string[] = [],
): Promise<string> {
  const actor = await requireActor("card:create");
  await assertCanCreateInBoard(boardId);
  const db = createAdminClient();
  const { board, firstStageId } = await boardAndFirstStage(db, boardId);
  const card = await insertCard(db, actor.userId as string, board, firstStageId, title);
  await copyTemplatesToCard(card.id, templateIds);
  revalidatePath("/board");
  return card.id;
}

/**
 * "+ Adicionar card" no pé de uma coluna (só pipelines de formulário `simple`).
 *
 * O card SEMPRE nasce na 1ª etapa; se a coluna escolhida for outra, ele é
 * levado até lá pelo CardService.move, como qualquer movimentação. Assim criar
 * direto numa etapa adiantada não vira atalho para pular regras de fluxo.
 */
export async function createCardInStage(
  boardId: string,
  title: string,
  stageId: string,
): Promise<CreatedCard> {
  const actor = await requireActor("card:create");
  await assertCanCreateInBoard(boardId);
  const db = createAdminClient();
  const { board, firstStageId } = await boardAndFirstStage(db, boardId);
  if ((board.creation_form ?? "simple") !== "simple") {
    throw new Error("Este pipeline pede o formulário completo. Use o botão “Novo card”.");
  }

  if (stageId !== firstStageId) {
    const { data: stage } = await db
      .from("stage")
      .select("id")
      .eq("id", stageId)
      .eq("board_id", board.id)
      .maybeSingle();
    if (!stage) throw new Error("Etapa não encontrada neste pipeline.");
  }

  const card = await insertCard(db, actor.userId as string, board, firstStageId, title);
  const { data: me } = await db
    .from("app_user")
    .select("name, email")
    .eq("id", actor.userId as string)
    .maybeSingle();
  const created: CreatedCard = {
    ...card,
    stageId: firstStageId,
    requesterName: me?.name || me?.email || "?",
  };
  if (stageId !== firstStageId) {
    const res = await moveCard(card.id, stageId);
    if (res.ok) {
      const { data } = await db.from("card").select("position").eq("id", card.id).maybeSingle();
      created.stageId = stageId;
      created.position = data ? Number(data.position) : created.position;
    } else {
      created.blockedReason = `Card criado na primeira etapa. ${res.reason}`;
    }
  }
  return created;
}

/** Troca o solicitante do card (nativo, ao lado do responsável). */
export async function setCardRequester(cardId: string, userId: string | null): Promise<void> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const { error } = await db
    .from("card")
    .update({ requester_id: userId })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Cria um card e seta os valores das propriedades de uma vez (form de criação
 * genérico/personalizado). Cria na 1ª etapa; ignora valores vazios. Retorna o id.
 */
export async function createCardWithFields(
  boardId: string,
  title: string,
  values: { fieldId: string; value: string | number | boolean | null }[],
  /** Modelos de checklist do pipeline com que o card já nasce (opcional). */
  templateIds: string[] = [],
): Promise<string> {
  const actor = await requireActor("card:create");
  await assertCanCreateInBoard(boardId);
  const db = createAdminClient();

  const { board, firstStageId } = await boardAndFirstStage(db, boardId);
  const card = await insertCard(db, actor.userId as string, board, firstStageId, title);

  for (const v of values) {
    if (v.value === null || v.value === "") continue;
    await setFieldValue(card.id, v.fieldId, v.value);
  }
  await copyTemplatesToCard(card.id, templateIds);
  revalidatePath("/board");
  return card.id;
}

// ── Pipelines (boards) — criar / renomear / arquivar (só Gestor) ─────────────

/**
 * Cria um pipeline: em branco, com 3 colunas padrão (A fazer / Fazendo / Feito),
 * ou a partir de um modelo (`lib/board/templates.ts`), com etapas, propriedades
 * e opções prontas.
 */
export async function createBoard(name: string, templateId?: string): Promise<string> {
  const template = templateId ? BOARD_TEMPLATES.find((t) => t.id === templateId) : undefined;
  const actor = await requireActor("board:configure");
  const db = createAdminClient();
  const orgId = actor.organizationId as string;

  const { data: board, error } = await db
    .from("board")
    .insert({ organization_id: orgId, name: name.trim() || "Novo pipeline" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const defaults: { name: string; category: string; countsRework?: boolean }[] = template?.stages ?? [
    { name: "A fazer", category: "backlog" },
    { name: "Fazendo", category: "in_progress" },
    { name: "Feito", category: "done" },
  ];
  const stageRows = defaults.map((s, i) => ({
    organization_id: orgId,
    board_id: board.id,
    name: s.name,
    category: s.category,
    position: i,
  }));
  const withRework = defaults.some((s) => s.countsRework);
  const { error: stageErr } = await db
    .from("stage")
    .insert(withRework ? stageRows.map((r, i) => ({ ...r, counts_rework: !!defaults[i]!.countsRework })) : stageRows);
  // Sem a migration 0042 a etapa de emenda não existe: cria as etapas sem ela.
  if (stageErr && withRework) await db.from("stage").insert(stageRows);
  else if (stageErr) throw new Error(stageErr.message);

  if (template) {
    if (template.fields.length > 0) {
      await db.from("field_definition").insert(
        template.fields.map((f, i) => ({
          organization_id: orgId,
          board_id: board.id,
          name: f.name,
          type: f.type,
          config: f.options ? { options: templateOptions(f.options) } : {},
          show_on_card_face: !!f.showOnCard,
          show_on_create: !!f.showOnCreate,
          is_filterable: true,
          position: i,
        })),
      );
    }
    const o = template.options;
    const flags = { my_tasks: !!o.myTasks, time_tracking: !!o.timeTracking, own_panel: !!o.ownPanel };
    const { error: flagErr } = await db.from("board").update(flags).eq("id", board.id);
    if (flagErr) {
      // Sem a 0042: liga ao menos "Minhas demandas" e o cronômetro (0041).
      const { own_panel: _skip, ...rest } = flags;
      await db.from("board").update(rest).eq("id", board.id);
    }
  }

  revalidatePath("/board");
  return board.id;
}

export async function renameBoard(boardId: string, name: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { error } = await db
    .from("board")
    .update({ name: name.trim() || "Pipeline" })
    .eq("id", boardId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function setBoardArchived(boardId: string, archived: boolean): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { error } = await db
    .from("board")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", boardId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/** Define o modo do formulário de criação do pipeline (simple/generic/custom:*). */
export async function setBoardCreationForm(boardId: string, mode: string): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const { error } = await db.from("board").update({ creation_form: mode }).eq("id", boardId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Define quem pode abrir o formulário de criação deste pipeline.
 * `userIds` só é usado no modo "users"; nos demais a lista é zerada, para não
 * deixar resíduo que reapareceria ao voltar para esse modo.
 */
export async function setBoardIntake(
  boardId: string,
  intake: Intake,
  userIds: string[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAlcadaManager();
  const modo: Intake = intake === "org" || intake === "users" ? intake : "members";
  if (modo === "users" && userIds.length === 0) {
    return { ok: false, error: "Escolha ao menos uma pessoa, ou use outra opção." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("board")
    .update({ intake: modo, intake_user_ids: modo === "users" ? userIds : [] })
    .eq("id", boardId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/board");
  revalidatePath("/configuracoes/alcadas");
  return { ok: true };
}

/** Configuração atual da caixa de entrada de um pipeline. */
export async function loadBoardIntake(
  boardId: string,
): Promise<{ intake: Intake; userIds: string[] }> {
  await requireAlcadaManager();
  const db = createAdminClient();
  const { data } = await db
    .from("board")
    .select("intake, intake_user_ids")
    .eq("id", boardId)
    .maybeSingle();
  return {
    intake: parseIntake(data?.intake),
    userIds: (data?.intake_user_ids as string[] | null) ?? [],
  };
}

/** Salva os limites de alçada do pipeline (Direção Geral ou Gestor). */
export async function setBoardAlcadaThresholds(
  boardId: string,
  thresholds: Thresholds,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAlcadaManager();
  const invalid = validateThresholds(thresholds);
  if (invalid) return { ok: false, error: invalid };

  const db = createAdminClient();
  const { error } = await db
    .from("board")
    .update({ alcada_thresholds: thresholds })
    .eq("id", boardId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/board");
  revalidatePath("/configuracoes/alcadas");
  return { ok: true };
}

/**
 * Move um card de etapa PELO CardService — avalia os gates (workflow_rules) no
 * servidor. Se um gate block barrar, retorna { ok:false, reason } (não move).
 *
 * `placement` diz onde o card foi solto dentro da coluna (vizinho de cima e de
 * baixo). Também serve para só reordenar na mesma etapa: aí o CardService
 * confere a permissão, não há troca de etapa e só a posição é gravada.
 */
export async function moveCard(
  cardId: string,
  toStageId: string,
  placement?: Placement,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const actor = await provisionAndGetActor();
  if (!actor) return { ok: false, reason: "Sessão expirada. Entre novamente." };
  try {
    await assertCardScope(actor, cardId);
  } catch {
    return { ok: false, reason: "Card não encontrado." };
  }

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

/** Atualiza o card: título e/ou descrição (só os campos informados). */
export async function updateCard(input: {
  id: string;
  title?: string;
  description?: string;
  /** Prazo do card (AAAA-MM-DD); null remove o prazo. */
  dueDate?: string | null;
  /** Correção manual do número de emendas (a contagem automática continua valendo). */
  reworkCount?: number;
}): Promise<void> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, input.id);
  const db = createAdminClient();
  // Prazo e emendas: só quem gerencia o pipeline (Gestor de área dele, Gestor,
  // Gestor Master). `stage:manage` é o que separa a gestão dos demais membros,
  // e o escopo acima garante que é um pipeline dela.
  if (input.dueDate !== undefined || input.reworkCount !== undefined) {
    await assertCanManageCard(actor, input.id);
  }
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim() || "Novo card";
  if (input.description !== undefined) patch.description = input.description;
  let dueChange: { from: string | null; to: string | null } | null = null;
  if (input.dueDate !== undefined) {
    const to = input.dueDate ? input.dueDate.slice(0, 10) : null;
    if (to !== null && !isRealDate(to)) throw new Error("Data de prazo inválida.");
    const { data: cur } = await db.from("card").select("due_date").eq("id", input.id).maybeSingle();
    const from = (cur?.due_date as string | null) ?? null;
    if (from !== to) {
      patch.due_date = to;
      dueChange = { from, to };
    }
  }
  let reworkChange: { from: number; to: number } | null = null;
  if (input.reworkCount !== undefined) {
    const to = Math.floor(Number(input.reworkCount));
    if (!Number.isFinite(to) || to < 0 || to > 999) throw new Error("Número de emendas inválido.");
    const { data: cur } = await db.from("card").select("rework_count").eq("id", input.id).maybeSingle();
    const from = Number(cur?.rework_count ?? 0);
    if (from !== to) {
      patch.rework_count = to;
      reworkChange = { from, to };
    }
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await db.from("card").update(patch).eq("id", input.id);
  if (error) throw new Error(error.message);
  if (dueChange) await recordActivity(input.id, actor.userId as string, "due_date_changed", dueChange);
  if (reworkChange) await recordActivity(input.id, actor.userId as string, "rework_changed", reworkChange);
  revalidatePath("/board");
}

/**
 * Quem gerencia o pipeline do card: tem `stage:manage` e enxerga o PIPELINE
 * (não basta enxergar o card, como o solicitante de fora do pipeline).
 */
async function assertCanManageCard(actor: Actor, cardId: string): Promise<void> {
  if (!actor.permissions.has("stage:manage")) {
    throw new ForbiddenError("Só a gestão do pipeline pode alterar o prazo e as emendas.");
  }
  const { data: card } = await createAdminClient().from("card").select("board_id").eq("id", cardId).maybeSingle();
  if (!card) throw new Error("Card não encontrado.");
  await assertBoardScope(actor, card.board_id);
}

/** "AAAA-MM-DD" que existe no calendário (recusa 2026-02-31 e afins). */
function isRealDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/**
 * Arquiva ou reativa um card. Arquivar NÃO apaga nada: o card só sai dos
 * quadros, listas e relatórios, e pode voltar pela lista "Arquivados" do
 * pipeline. Ao reativar, volta para a etapa em que estava, no fim da coluna.
 */
export async function setCardArchived(
  cardId: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("card:update");
  // A sessão (RLS) decide se a pessoa enxerga o card; só então a escrita.
  const { data: visible } = await (await createClient())
    .from("card")
    .select("id, stage_id, archived_at")
    .eq("id", cardId)
    .maybeSingle();
  if (!visible) return { ok: false, error: "Card não encontrado." };
  if ((visible.archived_at != null) === archived) return { ok: true };

  const db = createAdminClient();
  const patch: Record<string, unknown> = { archived_at: archived ? new Date().toISOString() : null };
  if (!archived) patch.position = await endOfStagePosition(db, visible.stage_id);
  const { error } = await db.from("card").update(patch).eq("id", cardId);
  if (error) return { ok: false, error: "Não foi possível gravar. Tente de novo." };
  await recordActivity(cardId, actor.userId as string, archived ? "card_archived" : "card_restored", {});
  if (archived) await stopTimersOnCard(cardId);
  return { ok: true };
}

/** Cards arquivados de um pipeline, do mais recente para o mais antigo. */
export async function loadArchivedCards(boardId: string): Promise<ArchivedCard[]> {
  await requireActor("card:read");
  const db = await createClient(); // sessão → RLS
  const [{ data: cards }, { data: stages }] = await Promise.all([
    db
      .from("card")
      .select("id, number, title, stage_id, archived_at")
      .eq("board_id", boardId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(300),
    db.from("stage").select("id, name").eq("board_id", boardId),
  ]);
  const stageName = new Map((stages ?? []).map((s) => [s.id, s.name]));
  return (cards ?? []).map((c) => ({
    id: c.id,
    number: Number(c.number),
    title: c.title,
    stageName: stageName.get(c.stage_id) ?? "",
    archivedAt: c.archived_at as string,
  }));
}

/** Carrega a visão expandida do card (página): cabeçalho + propriedades + detalhe. */
export async function loadCardPage(cardId: string): Promise<CardPageData | null> {
  const db = await createClient(); // sessão → RLS
  const { data: card } = await db
    .from("card")
    .select("id, number, title, description, board_id, stage_id, archived_at, due_date, rework_count")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return null;

  const [boardRes, stageRes, detail, fields, valuesRaw, reworkStage, actor] = await Promise.all([
    db.from("board").select("name").eq("id", card.board_id).maybeSingle(),
    db.from("stage").select("name").eq("id", card.stage_id).maybeSingle(),
    loadCardDetail(cardId),
    loadFields(card.board_id),
    loadCardFieldValues(cardId),
    // O pipeline conta emendas? (tem alguma etapa marcada como "de emenda")
    db.from("stage").select("id").eq("board_id", card.board_id).eq("counts_rework", true).limit(1),
    provisionAndGetActor(),
  ]);

  const values: Record<string, FieldValueRaw> = {};
  for (const v of valuesRaw) values[v.fieldId] = v;

  return {
    id: card.id,
    number: Number(card.number),
    title: card.title,
    description: card.description ?? null,
    boardId: card.board_id,
    boardName: boardRes.data?.name ?? "",
    stageId: card.stage_id,
    stageName: stageRes.data?.name ?? "",
    archivedAt: card.archived_at ?? null,
    dueDate: card.due_date ?? null,
    reworkCount: (reworkStage.data ?? []).length > 0 ? Number(card.rework_count ?? 0) : null,
    // A leitura do pipeline passa pelo RLS: só vem para quem enxerga o pipeline.
    canManage: !!boardRes.data && (actor?.permissions.has("stage:manage") ?? false),
    fields,
    values,
    detail,
  };
}

/** Tudo que a visão de Lista precisa além dos cards, numa ida só ao servidor. */
export async function loadListData(boardId: string): Promise<{
  fields: FieldDef[];
  values: { cardId: string; value: FieldValueRaw }[];
  members: MemberOption[];
  prioritizedCardIds: string[];
}> {
  const db = await createClient(); // sessão → RLS
  const [fields, values, members, prio] = await Promise.all([
    loadFields(boardId),
    loadFieldValuesByBoard(boardId),
    loadMembers(),
    db.from("prioritization").select("card_id").eq("board_id", boardId).is("archived_at", null),
  ]);
  return {
    fields,
    values,
    members,
    prioritizedCardIds: (prio.data ?? []).map((p) => p.card_id),
  };
}

/** Detalhe do card numa chamada só — os 6 leitores em paralelo (1 round trip). */
export async function loadCardDetail(cardId: string): Promise<CardDetailData> {
  const db = await createClient(); // sessão → RLS
  const [checklists, attachments, activity, comments, responsibleId, members, cardRes] =
    await Promise.all([
      loadChecklists(cardId),
      loadAttachments(cardId),
      loadActivity(cardId),
      loadComments(cardId),
      loadCardResponsible(cardId),
      loadMembers(),
      db.from("card").select("description, requester_id").eq("id", cardId).maybeSingle(),
    ]);
  return {
    description: cardRes.data?.description ?? null,
    checklists,
    attachments,
    activity,
    comments,
    responsibleId,
    requesterId: cardRes.data?.requester_id ?? null,
    members,
  };
}

// ── Checklists ───────────────────────────────────────────────────────────────

export async function loadChecklists(cardId: string): Promise<ChecklistView[]> {
  const db = await createClient(); // sessão → RLS escopa por usuário
  const { data: lists } = await db
    .from("checklist")
    .select("id, name, position")
    .eq("card_id", cardId)
    .order("position");
  if (!lists || lists.length === 0) return [];

  const { data: items } = await db
    .from("checklist_item")
    .select("id, checklist_id, text, done, position")
    .in(
      "checklist_id",
      lists.map((l) => l.id),
    )
    .order("position");

  const byList = new Map<string, ChecklistItemView[]>();
  for (const it of items ?? []) {
    const arr = byList.get(it.checklist_id) ?? [];
    arr.push({ id: it.id, text: it.text, done: it.done, position: Number(it.position) });
    byList.set(it.checklist_id, arr);
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    position: Number(l.position),
    items: byList.get(l.id) ?? [],
  }));
}

async function nextPosition(
  db: ReturnType<typeof createAdminClient>,
  table: "checklist" | "checklist_item",
  column: "card_id" | "checklist_id",
  value: string,
): Promise<number> {
  const { data } = await db
    .from(table)
    .select("position")
    .eq(column, value)
    .order("position", { ascending: false })
    .limit(1);
  const top = data?.[0];
  return top ? Number(top.position) + 1 : 0;
}

export async function addChecklist(cardId: string, name: string): Promise<void> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const position = await nextPosition(db, "checklist", "card_id", cardId);
  const { error } = await db.from("checklist").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    name: name.trim() || "Checklist",
    position,
  });
  if (error) throw new Error(error.message);
}

export async function addChecklistItem(checklistId: string, text: string): Promise<void> {
  const actor = await requireActor("card:update");
  await assertChecklistScope(actor, checklistId);
  const db = createAdminClient();
  const position = await nextPosition(db, "checklist_item", "checklist_id", checklistId);
  const { error } = await db
    .from("checklist_item")
    .insert({ checklist_id: checklistId, text: text.trim(), position });
  if (error) throw new Error(error.message);
}

export async function setChecklistItemDone(itemId: string, done: boolean): Promise<void> {
  const actor = await requireActor("card:update");
  await assertChecklistItemScope(actor, itemId);
  const db = createAdminClient();
  const { data: item } = await db
    .from("checklist_item")
    .select("text, checklist_id")
    .eq("id", itemId)
    .maybeSingle();

  const { error } = await db.from("checklist_item").update({ done }).eq("id", itemId);
  if (error) throw new Error(error.message);

  // Log de atividade: quem marcou/desmarcou o quê (feed estilo Trello).
  if (item) {
    const { data: cl } = await db
      .from("checklist")
      .select("card_id")
      .eq("id", item.checklist_id)
      .maybeSingle();
    if (cl) {
      await recordActivity(
        cl.card_id,
        actor.userId,
        done ? "checklist_checked" : "checklist_unchecked",
        { text: item.text },
      );
    }
  }
}

export async function loadActivity(cardId: string): Promise<ActivityView[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("activity")
    .select("id, kind, payload, created_at, actor_id")
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = data ?? [];

  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const nameOf = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await db
      .from("app_user")
      .select("id, name, email")
      .in("id", actorIds);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: (r.payload as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
    actorName: nameOf.get(r.actor_id) ?? "Alguém",
  }));
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const actor = await requireActor("card:update");
  await assertChecklistItemScope(actor, itemId);
  const db = createAdminClient();
  const { error } = await db.from("checklist_item").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  const actor = await requireActor("card:update");
  await assertChecklistScope(actor, checklistId);
  const db = createAdminClient();
  const { error } = await db.from("checklist").delete().eq("id", checklistId);
  if (error) throw new Error(error.message);
}

// ── Anexos (qualquer link clicável) ──────────────────────────────────────────

function normalizeUrl(url: string): string {
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function loadAttachments(cardId: string): Promise<AttachmentView[]> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("attachment")
    .select("id, label, url")
    .eq("card_id", cardId)
    .order("created_at");
  return (data ?? []).map((a) => ({ id: a.id, label: a.label, url: a.url }));
}

export async function addAttachment(
  cardId: string,
  url: string,
  label: string,
): Promise<void> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  if (!url.trim()) throw new Error("Informe um link.");
  const { data: card } = await db.from("card").select("organization_id").eq("id", cardId).single();
  if (!card) throw new Error("Card não encontrado.");
  const { error } = await db.from("attachment").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    kind: "link",
    url: normalizeUrl(url),
    label: label.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteAttachment(id: string): Promise<void> {
  const actor = await requireActor("card:update");
  await assertAttachmentScope(actor, id);
  const db = createAdminClient();
  const { error } = await db.from("attachment").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Responsável por etapa (assignment card↔user↔etapa) ───────────────────────

export async function loadMembers(): Promise<MemberOption[]> {
  const db = await createClient(); // sessão → RLS
  // Quem teve o acesso revogado não deve ser oferecido como responsável.
  const { data } = await db
    .from("app_user")
    .select("id, name, email")
    .is("archived_at", null)
    .order("name");
  return (data ?? []).map((u) => ({ id: u.id, name: u.name || u.email }));
}

/** Responsável do card (assignment com stage_id nulo). null = sem responsável. */
export async function loadCardResponsible(cardId: string): Promise<string | null> {
  const db = await createClient(); // sessão → RLS
  const { data } = await db
    .from("assignment")
    .select("user_id")
    .eq("card_id", cardId)
    .is("stage_id", null)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Define o responsável do CARD (único, independente de etapa). userId null =
 * remove. Trocado manualmente; mover o card de etapa não altera.
 */
export async function setCardResponsible(
  cardId: string,
  userId: string | null,
): Promise<void> {
  const actor = await requireActor("card:assign");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id, number, title")
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
      const { data: meU } = await db
        .from("app_user")
        .select("name, email")
        .eq("id", actor.userId as string)
        .maybeSingle();
      await db.from("notification").insert({
        organization_id: card.organization_id,
        user_id: userId,
        kind: "assignment",
        payload: {
          actorName: meU?.name || meU?.email || "Alguém",
          cardNumber: card.number,
          cardTitle: card.title,
        },
      });
      await sendPush([userId], {
        title: `${meU?.name || meU?.email || "Alguém"} atribuiu um card a você`,
        body: `#${card.number} ${card.title}`,
        url: `/board?card=${cardId}`,
        tag: `card-${cardId}`,
      });
    }
  }
  revalidatePath("/board");
}

// ── Usuários (acessos) ───────────────────────────────────────────────────────

// Estas duas leem com a chave de serviço, que ignora a RLS. Server action é
// endpoint público para quem está logado: sem o requireActor, qualquer pessoa
// autenticada listaria todos os usuários e papéis da organização.
export async function loadRoles(): Promise<RoleOption[]> {
  await requireActor("user:manage");
  const db = createAdminClient();
  const { data } = await db.from("role").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export async function loadUsers(): Promise<UserRow[]> {
  await requireActor("user:manage");
  const db = createAdminClient();
  const [usersRes, ursRes, rolesRes, membersRes, phonesRes] = await Promise.all([
    db.from("app_user").select("id, name, email, is_internal, cargo, archived_at").order("name"),
    db.from("user_role").select("user_id, role_id"),
    db.from("role").select("id, name, permissions"),
    db.from("board_member").select("board_id, user_id"),
    // Antes da migration 0044 a tabela não existe: a consulta falha e a coluna fica vazia.
    db.from("user_phone").select("user_id, phone"),
  ]);
  const phoneOf = new Map((phonesRes.data ?? []).map((p) => [p.user_id, formatPhone(p.phone)]));
  const roleName = new Map((rolesRes.data ?? []).map((r) => [r.id, r.name]));
  const roleSeesAll = new Map(
    (rolesRes.data ?? []).map((r) => [r.id, Array.isArray(r.permissions) && r.permissions.includes("board:configure")]),
  );
  const boardsOf = new Map<string, string[]>();
  for (const m of membersRes.data ?? []) {
    boardsOf.set(m.user_id, [...(boardsOf.get(m.user_id) ?? []), m.board_id]);
  }
  const roleOfUser = new Map<string, string>();
  for (const ur of ursRes.data ?? []) roleOfUser.set(ur.user_id, ur.role_id);

  return (usersRes.data ?? []).map((u) => {
    const roleId = roleOfUser.get(u.id) ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      internal: u.is_internal,
      roleId,
      roleName: roleId ? (roleName.get(roleId) ?? null) : null,
      cargo: u.cargo ?? null,
      archived: u.archived_at != null,
      seesAllBoards: u.is_internal && !!roleId && roleSeesAll.get(roleId) === true,
      boardIds: boardsOf.get(u.id) ?? [],
      phone: phoneOf.get(u.id) ?? null,
    };
  });
}

/**
 * Define de uma vez os pipelines que a pessoa enxerga (membro). Vale para quem
 * não vê todos: Gestor de área e Membro interno. Só Gestor.
 */
export async function setUserBoards(userId: string, boardIds: string[]): Promise<void> {
  const actor = await requireActor("board:configure");
  const db = createAdminClient();
  const [{ data: boards }, { data: current }] = await Promise.all([
    db.from("board").select("id").eq("organization_id", actor.organizationId as string),
    db.from("board_member").select("board_id").eq("user_id", userId),
  ]);
  const valid = new Set((boards ?? []).map((b) => b.id));
  const wanted = new Set(boardIds.filter((id) => valid.has(id)));
  const had = new Set((current ?? []).map((m) => m.board_id));
  const add = [...wanted].filter((id) => !had.has(id));
  const remove = [...had].filter((id) => valid.has(id) && !wanted.has(id));
  if (add.length) {
    const { error } = await db
      .from("board_member")
      .upsert(add.map((board_id) => ({ board_id, user_id: userId })), { onConflict: "board_id,user_id" });
    if (error) throw new Error(error.message);
  }
  if (remove.length) {
    const { error } = await db.from("board_member").delete().eq("user_id", userId).in("board_id", remove);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/configuracoes/usuarios");
  revalidatePath("/board");
}

/** Define o cargo (organograma) de um usuário — usado nas alçadas de demandas. */
export async function setUserCargo(userId: string, cargo: string | null): Promise<void> {
  await requireActor("user:manage");
  const db = createAdminClient();
  const { error } = await db
    .from("app_user")
    .update({ cargo: cargo || null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/configuracoes/usuarios");
}

/**
 * Pré-cadastra um usuário por e-mail (só Gestor). Cria o usuário de auth (FK
 * obrigatória do app_user → auth.users) já confirmado, sem enviar e-mail, e o
 * app_user correspondente. No 1º login com Google (mesmo e-mail) a conta é
 * vinculada. Interno/externo é escolhido no formulário. Papel opcional.
 */
export async function createUser(input: {
  email: string;
  name: string;
  roleId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("user:manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "E-mail inválido." };
  }
  const db = createAdminClient();

  const { data: existing } = await db
    .from("app_user")
    .select("id")
    .eq("organization_id", actor.organizationId as string)
    .eq("email", email)
    .maybeSingle();
  if (existing) return { ok: false, error: "Já existe um usuário com esse e-mail." };

  // Interno/externo NÃO é escolha de formulário: deriva do domínio, igual ao
  // login (`provisionAndGetActor`). Antes, marcar "interno" num e-mail de fora
  // permitia dar papel de gestão a alguém externo — a checagem abaixo seria
  // burlada até o 1º login corrigir o campo.
  const internal = isInternalEmail(email);

  if (input.roleId) {
    const { data: papel } = await db
      .from("role")
      .select("name, permissions, organization_id")
      .eq("id", input.roleId)
      .maybeSingle();
    if (!papel || papel.organization_id !== (actor.organizationId as string)) {
      return { ok: false, error: "Papel inválido." };
    }
    const perms = ((papel.permissions as string[] | null) ?? []) as Action[];
    if (!internal && GESTAO.some((a) => perms.includes(a))) {
      return {
        ok: false,
        error: `"${papel.name}" é um papel de gestão e só pode ser dado a e-mails do domínio da organização.`,
      };
    }
  }

  // Cria o auth user (ou reaproveita, se já existir no auth mas não no app_user).
  let userId: string;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    const { data: list } = await db.auth.admin.listUsers();
    const found = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) return { ok: false, error: createErr?.message ?? "Falha ao criar o usuário." };
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  const { error: upErr } = await db.from("app_user").upsert(
    {
      id: userId,
      organization_id: actor.organizationId as string,
      email,
      name: input.name.trim() || (email.split("@")[0] ?? email),
      is_internal: internal,
    },
    { onConflict: "id" },
  );
  if (upErr) return { ok: false, error: upErr.message };

  if (input.roleId) {
    await db.from("user_role").delete().eq("user_id", userId);
    await db.from("user_role").insert({ user_id: userId, role_id: input.roleId });
  }

  revalidatePath("/configuracoes/usuarios");
  return { ok: true };
}

/** Ações que caracterizam poder de gestão — vedadas a usuário externo. */
const GESTAO: Action[] = ACOES_DE_GESTAO;

/** Quantos usuários ativos têm `user:manage` hoje (para não zerar a gestão). */
async function contarGestores(db: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data: roles } = await db.from("role").select("id, permissions");
  const gestorRoleIds = (roles ?? [])
    .filter((r) => ((r.permissions as string[] | null) ?? []).includes("user:manage"))
    .map((r) => r.id);
  if (gestorRoleIds.length === 0) return [];

  const { data: urs } = await db.from("user_role").select("user_id").in("role_id", gestorRoleIds);
  const ids = [...new Set((urs ?? []).map((u) => u.user_id))];
  if (ids.length === 0) return [];

  // Usuário arquivado não conta: ele não consegue mais entrar.
  const { data: ativos } = await db
    .from("app_user")
    .select("id")
    .in("id", ids)
    .is("archived_at", null);
  return (ativos ?? []).map((u) => u.id);
}

/**
 * Troca o papel de um usuário (um papel por usuário), com duas travas:
 *
 * 1. Usuário EXTERNO não recebe papel de gestão. Ele entra por convite e por
 *    atribuição; deixá-lo virar Gestor daria a alguém de fora o controle da
 *    base inteira, inclusive de quem mais entra.
 * 2. Não é possível remover o último Gestor ativo. Sem isso a organização se
 *    tranca do lado de fora: `user:manage` é o que libera esta tela, e o
 *    bootstrap automático só age em usuário sem papel algum — o caminho de
 *    volta seria SQL manual no banco.
 */
export async function setUserRole(userId: string, roleId: string): Promise<void> {
  const actor = await requireActor("user:manage");
  const db = createAdminClient();

  const [{ data: alvo }, { data: papel }] = await Promise.all([
    db.from("app_user").select("id, email, organization_id").eq("id", userId).maybeSingle(),
    db.from("role").select("id, name, permissions, organization_id").eq("id", roleId).maybeSingle(),
  ]);
  if (!alvo) throw new Error("Usuário não encontrado.");
  if (!papel) throw new Error("Papel não encontrado.");
  // Papel de outra organização não se mistura com este usuário.
  if (papel.organization_id !== alvo.organization_id) throw new Error("Papel inválido.");
  if (alvo.organization_id !== (actor.organizationId as string)) {
    throw new Error("Usuário de outra organização.");
  }

  const perms = ((papel.permissions as string[] | null) ?? []) as Action[];

  // Conceder um papel administrativo é conceder controle sobre o próprio
  // controle de acesso. Fica reservado ao Gestor Master: um Gestor comum
  // administra usuários, mas não promove ninguém a Gestor.
  if (ehPapelAdministrativo(perms) && !actor.permissions.has("role:manage")) {
    throw new Error(
      `Só o Gestor Master pode atribuir o papel "${papel.name}". Peça a ele.`,
    );
  }

  const ehGestao = GESTAO.some((a) => perms.includes(a));
  // Calcula pelo domínio em vez de ler `is_internal`: contas criadas pelo
  // formulário antigo têm o valor errado gravado (dava para marcar "interno"
  // à mão), e a coluna só se corrige no primeiro login — tarde demais se o
  // papel de gestão já tiver sido concedido.
  if (ehGestao && !isInternalEmail(alvo.email)) {
    throw new Error(
      `Usuário externo não pode receber o papel "${papel.name}". Papéis de gestão são exclusivos de e-mails do domínio da organização.`,
    );
  }

  if (!perms.includes("user:manage")) {
    const gestores = await contarGestores(db);
    if (gestores.length === 1 && gestores[0] === userId) {
      throw new Error(
        "Este é o último usuário com gestão de acessos. Promova outra pessoa antes de mudar o papel dele.",
      );
    }
  }

  await db.from("user_role").delete().eq("user_id", userId);
  const { error } = await db.from("user_role").insert({ user_id: userId, role_id: roleId });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracoes/usuarios");
}

/** Corrige o nome exibido de um usuário. */
export async function setUserName(userId: string, name: string): Promise<void> {
  await requireActor("user:manage");
  const limpo = name.trim();
  if (!limpo) throw new Error("O nome não pode ficar vazio.");
  const db = createAdminClient();
  const { error } = await db.from("app_user").update({ name: limpo }).eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/configuracoes/usuarios");
}

/**
 * Revoga (ou devolve) o acesso de um usuário. Arquivar não apaga nada: o
 * histórico de cards, comentários e aprovações continua atribuído a ele — por
 * isso arquivar, e não excluir.
 */
export async function setUserArchived(userId: string, archived: boolean): Promise<void> {
  const actor = await requireActor("user:manage");
  const db = createAdminClient();

  if (archived) {
    if (userId === (actor.userId as string)) {
      throw new Error("Você não pode revogar o próprio acesso.");
    }
    const gestores = await contarGestores(db);
    if (gestores.length === 1 && gestores[0] === userId) {
      throw new Error(
        "Este é o último usuário com gestão de acessos. Promova outra pessoa antes de revogar o acesso dele.",
      );
    }
  }

  const { error } = await db
    .from("app_user")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/configuracoes/usuarios");
}

// ── Acesso a pipelines (board_member) — só Gestor (board:configure) ──────────

/** Usuários internos + quem já é membro do pipeline. Para a UI de acesso. */
export async function loadBoardMembers(
  boardId: string,
): Promise<{ memberIds: string[]; users: MemberOption[] }> {
  await requireActor("board:configure");
  const db = createAdminClient();
  const [memRes, usersRes] = await Promise.all([
    db.from("board_member").select("user_id").eq("board_id", boardId),
    db
      .from("app_user")
      .select("id, name, email")
      .eq("is_internal", true)
      .is("archived_at", null)
      .order("name"),
  ]);
  return {
    memberIds: (memRes.data ?? []).map((m) => m.user_id),
    users: (usersRes.data ?? []).map((u) => ({ id: u.id, name: u.name || u.email })),
  };
}

/** Inclui/remove um usuário do pipeline (define o que ele enxerga). */
export async function setBoardMember(
  boardId: string,
  userId: string,
  member: boolean,
): Promise<void> {
  await requireActor("board:configure");
  const db = createAdminClient();
  if (member) {
    await db
      .from("board_member")
      .upsert({ board_id: boardId, user_id: userId }, { onConflict: "board_id,user_id" });
  } else {
    await db.from("board_member").delete().eq("board_id", boardId).eq("user_id", userId);
  }
  revalidatePath("/board");
}

// ── Comentários ──────────────────────────────────────────────────────────────

export async function loadComments(cardId: string): Promise<CommentView[]> {
  const db = await createClient(); // sessão → RLS
  const su = await getSessionUser();
  const { data } = await db
    .from("comment")
    .select("id, body, author_id, created_at")
    .eq("card_id", cardId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  const rows = data ?? [];

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const nameOf = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: users } = await db.from("app_user").select("id, name, email").in("id", authorIds);
    for (const u of users ?? []) nameOf.set(u.id, u.name || u.email);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: nameOf.get(r.author_id) ?? "Alguém",
    createdAt: r.created_at,
    isOwn: su?.id === r.author_id,
  }));
}

export async function addComment(
  cardId: string,
  body: string,
  mentions: string[] = [],
): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const actor = await requireActor("comment:create");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const { data: card } = await db
    .from("card")
    .select("organization_id, number, title, board_id")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card não encontrado.");

  // Menções válidas: usuários da org, distintos, exceto o próprio autor.
  const wanted = [...new Set(mentions)].filter((id) => id && id !== (actor.userId as string));
  let validIds: string[] = [];
  if (wanted.length > 0) {
    const { data: mentioned } = await db
      .from("app_user")
      .select("id")
      .eq("organization_id", card.organization_id)
      .in("id", wanted);
    validIds = (mentioned ?? []).map((u) => u.id);
  }

  const { error } = await db.from("comment").insert({
    organization_id: card.organization_id,
    card_id: cardId,
    author_id: actor.userId,
    body: text,
    mentions: validIds,
  });
  if (error) throw new Error(error.message);

  if (validIds.length === 0) return;

  const [{ data: me }, { data: board }] = await Promise.all([
    db.from("app_user").select("name, email").eq("id", actor.userId as string).maybeSingle(),
    db.from("board").select("name").eq("id", card.board_id).maybeSingle(),
  ]);
  const actorName = me?.name || me?.email || "Alguém";
  const boardName = board?.name ?? "";

  // Cada mencionado recebe uma DM (autor → pessoa) com o comentário + card.
  for (const uid of validIds) {
    const channelId = await ensureDmChannel(
      db,
      card.organization_id,
      actor.userId as string,
      uid,
    );
    await db.from("message").insert({
      organization_id: card.organization_id,
      channel_id: channelId,
      author_id: actor.userId,
      body: `💬 mencionou você no card #${card.number} «${card.title}»${boardName ? ` · ${boardName}` : ""}:\n${text}`,
      mentions: [],
    });
  }

  // …e uma notificação in-app (sininho).
  await db.from("notification").insert(
    validIds.map((uid) => ({
      organization_id: card.organization_id,
      user_id: uid,
      kind: "mention",
      payload: {
        actorName,
        cardNumber: card.number,
        cardTitle: card.title,
        boardName,
        snippet: text.slice(0, 120),
      },
    })),
  );
  await sendPush(validIds, {
    title: `${actorName} mencionou você`,
    body: `#${card.number} ${card.title}: ${text.slice(0, 120)}`,
    url: `/board?card=${cardId}`,
    tag: `card-${cardId}`,
  });
}

// ── Propriedades customizadas (campos) ───────────────────────────────────────

export async function loadFields(boardId: string): Promise<FieldDef[]> {
  const db = await createClient();
  // Campos deste pipeline + os GLOBAIS (board_id nulo). RLS escopa.
  const { data } = await db
    .from("field_definition")
    .select(
      "id, name, type, config, show_on_card_face, show_on_create, is_required, position, board_id, allowed_editors",
    )
    .or(`board_id.eq.${boardId},board_id.is.null`)
    .order("position");
  return (data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    options: (f.config?.options ?? []) as FieldDef["options"],
    showOnCardFace: f.show_on_card_face,
    showOnCreate: f.show_on_create ?? false,
    isRequired: f.is_required ?? false,
    position: Number(f.position),
    global: f.board_id === null,
    allowedEditors: (f.allowed_editors ?? []) as string[],
  }));
}

/** Define quem pode editar uma propriedade (vazio = todos). */
export async function setFieldEditors(fieldId: string, userIds: string[]): Promise<void> {
  await requireAlcadaManager();
  const db = createAdminClient();
  const { error } = await db
    .from("field_definition")
    .update({ allowed_editors: userIds })
    .eq("id", fieldId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
  revalidatePath("/configuracoes/alcadas");
}

const FIELD_VALUE_COLS =
  "card_id, field_definition_id, value_text, value_number, value_date, value_bool, value_member_id";

type FieldValueRow = {
  card_id: string;
  field_definition_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_bool: boolean | null;
  value_member_id: string | null;
};

function mapFieldValue(v: FieldValueRow): { cardId: string; value: FieldValueRaw } {
  return {
    cardId: v.card_id,
    value: {
      fieldId: v.field_definition_id,
      text: v.value_text,
      number: v.value_number,
      date: v.value_date,
      bool: v.value_bool,
      memberId: v.value_member_id,
    },
  };
}

/**
 * Valores de campo dos cards de UM pipeline. Preferir esta à
 * `loadAllFieldValues` — filtra no banco em vez de trazer a tabela inteira.
 */
export async function loadFieldValuesByBoard(
  boardId: string,
): Promise<{ cardId: string; value: FieldValueRaw }[]> {
  const db = await createClient();
  const { data: cards } = await db.from("card").select("id").eq("board_id", boardId);
  const ids = (cards ?? []).map((c) => c.id);
  if (ids.length === 0) return [];

  const out: { cardId: string; value: FieldValueRaw }[] = [];
  // Lotes para não estourar o limite de itens do `in()`.
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db
      .from("field_value")
      .select(FIELD_VALUE_COLS)
      .in("card_id", ids.slice(i, i + 500));
    for (const v of data ?? []) out.push(mapFieldValue(v));
  }
  return out;
}

/** Todos os valores de campo visíveis (RLS escopa). Prefira loadFieldValuesByBoard. */
export async function loadAllFieldValues(): Promise<
  { cardId: string; value: FieldValueRaw }[]
> {
  const db = await createClient();
  const { data } = await db.from("field_value").select(FIELD_VALUE_COLS);
  return (data ?? []).map(mapFieldValue);
}

export async function loadCardFieldValues(cardId: string): Promise<FieldValueRaw[]> {
  const db = await createClient();
  const { data } = await db
    .from("field_value")
    .select("field_definition_id, value_text, value_number, value_date, value_bool, value_member_id")
    .eq("card_id", cardId);
  return (data ?? []).map((v) => ({
    fieldId: v.field_definition_id,
    text: v.value_text,
    number: v.value_number,
    date: v.value_date,
    bool: v.value_bool,
    memberId: v.value_member_id,
  }));
}

export async function addField(
  boardId: string,
  name: string,
  type: FieldType,
  options?: { label: string; color: string }[],
  global = false,
): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertBoardScope(actor, boardId);
  const db = createAdminClient();
  const { data: board } = await db
    .from("board")
    .select("id, organization_id")
    .eq("id", boardId)
    .single();
  if (!board) throw new Error("Pipeline não encontrado.");
  // Próxima posição dentro do escopo (global = board_id nulo da org; senão o board).
  const posQ = db
    .from("field_definition")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  const { data: last } = global
    ? await posQ.is("board_id", null).eq("organization_id", board.organization_id)
    : await posQ.eq("board_id", board.id);
  const position = last?.[0] ? Number(last[0].position) + 1 : 0;

  const config =
    (type === "select" || type === "status") && options?.length
      ? { options: options.map((o, i) => ({ id: `opt${i}`, label: o.label, color: o.color })) }
      : {};

  const { error } = await db.from("field_definition").insert({
    organization_id: board.organization_id,
    board_id: global ? null : board.id,
    name: name.trim() || "Propriedade",
    type,
    config,
    show_on_card_face: false,
    is_filterable: true,
    position,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export interface FieldSyncResult {
  created: string[];
  optionsAdded: { name: string; labels: string[] }[];
  conflicts: { name: string; sourceType: string; targetType: string }[];
  unchanged: number;
}

/**
 * Traz para ESTE pipeline as propriedades de outro (as etapas não entram), para
 * que um card enviado de um para o outro encontre cada valor no seu lugar.
 * Só acrescenta: cria a propriedade que falta e as opções que faltam; nada é
 * apagado, renomeado ou tem o tipo trocado (`planFieldSync`, no core).
 * `apply: false` só mostra o que seria feito.
 */
export async function syncFieldsFromBoard(
  targetBoardId: string,
  sourceBoardId: string,
  apply: boolean,
): Promise<{ ok: true; result: FieldSyncResult } | { ok: false; error: string }> {
  const actor = await requireActor("field:manage");
  if (targetBoardId === sourceBoardId) return { ok: false, error: "Escolha outro pipeline como origem." };
  await assertBoardScope(actor, targetBoardId);
  await assertBoardScope(actor, sourceBoardId);

  const db = createAdminClient();
  const [boardsRes, fieldsRes] = await Promise.all([
    db.from("board").select("id, organization_id").in("id", [targetBoardId, sourceBoardId]),
    db
      .from("field_definition")
      .select("id, name, type, config, show_on_card_face, show_on_create, is_required, position, board_id")
      .in("board_id", [targetBoardId, sourceBoardId])
      .is("archived_at", null)
      .order("position"),
  ]);
  const org = actor.organizationId as string;
  const boards = boardsRes.data ?? [];
  if (boards.length !== 2 || boards.some((b) => b.organization_id !== org)) {
    return { ok: false, error: "Pipeline não encontrado." };
  }
  const rows = fieldsRes.data ?? [];
  const toSync = (boardId: string): SyncField[] =>
    rows
      .filter((f) => f.board_id === boardId)
      .map((f) => ({ id: f.id, name: f.name, type: f.type, options: (f.config?.options ?? []) as SyncField["options"] }));
  const target = toSync(targetBoardId);
  const plan = planFieldSync(toSync(sourceBoardId), target);
  const result: FieldSyncResult = {
    created: plan.create.map((f) => f.name),
    optionsAdded: plan.addOptions.map((a) => ({ name: a.name, labels: a.options.map((o) => o.label) })),
    conflicts: plan.conflicts,
    unchanged: plan.unchanged,
  };
  if (!apply) return { ok: true, result };

  if (plan.create.length > 0) {
    const rowOf = new Map(rows.map((f) => [f.id, f]));
    let position = rows.filter((f) => f.board_id === targetBoardId).reduce((m, f) => Math.max(m, Number(f.position)), -1);
    const { error } = await db.from("field_definition").insert(
      plan.create.map((f) => {
        const src = rowOf.get(f.id)!;
        return {
          organization_id: org,
          board_id: targetBoardId,
          name: src.name,
          type: src.type,
          config: src.config ?? {},
          show_on_card_face: src.show_on_card_face,
          show_on_create: src.show_on_create ?? false,
          is_required: src.is_required ?? false,
          is_filterable: true,
          position: ++position,
        };
      }),
    );
    if (error) return { ok: false, error: "Não foi possível criar as propriedades. Nada foi alterado nas opções." };
  }
  for (const add of plan.addOptions) {
    const current = rows.find((f) => f.id === add.targetId)!;
    const config = { ...(current.config ?? {}), options: [...((current.config?.options ?? []) as unknown[]), ...add.options] };
    const { error } = await db.from("field_definition").update({ config }).eq("id", add.targetId);
    if (error) return { ok: false, error: `Não foi possível acrescentar as opções de "${add.name}".` };
  }
  revalidatePath("/board");
  return { ok: true, result };
}

/**
 * Edita uma propriedade: nome, tipo e (para select/status) as opções. Se o TIPO
 * mudar, limpa os valores antigos — as colunas tipadas divergem e mostrariam
 * lixo. Opções mantêm o id posicional (opt0, opt1…) para não quebrar valores já
 * setados quando só os rótulos mudam.
 */
export async function updateField(
  fieldId: string,
  name: string,
  type: FieldType,
  options: { label: string; color: string }[] | undefined,
  scope: { global: boolean; boardId: string },
): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();
  const { data: existing } = await db
    .from("field_definition")
    .select("type")
    .eq("id", fieldId)
    .maybeSingle();
  if (!existing) throw new Error("Propriedade não encontrada.");

  const config =
    (type === "select" || type === "status") && options?.length
      ? { options: options.map((o, i) => ({ id: `opt${i}`, label: o.label, color: o.color })) }
      : {};

  const { error } = await db
    .from("field_definition")
    .update({
      name: name.trim() || "Propriedade",
      type,
      config,
      board_id: scope.global ? null : scope.boardId,
    })
    .eq("id", fieldId);
  if (error) throw new Error(error.message);

  if (existing.type !== type) {
    await db.from("field_value").delete().eq("field_definition_id", fieldId);
  }
  revalidatePath("/board");
}

export async function deleteField(fieldId: string): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();
  const { error } = await db.from("field_definition").delete().eq("id", fieldId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Move uma propriedade uma casa para a esquerda/direita. A ordem (`position`) é
 * a mesma usada pela lista, pelos chips do card e pelo card expandido — então
 * reordenar aqui reflete em todas as visões.
 *
 * Regrava a sequência inteira (0..n-1), o que também normaliza posições
 * duplicadas herdadas. Mover um campo GLOBAL muda a ordem em todos os pipelines,
 * que é o comportamento esperado de um campo global.
 */
export async function moveField(
  boardId: string,
  fieldId: string,
  direction: "left" | "right",
): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();

  const { data } = await db
    .from("field_definition")
    .select("id, position")
    .or(`board_id.eq.${boardId},board_id.is.null`)
    .order("position");
  const list = data ?? [];

  const i = list.findIndex((f) => f.id === fieldId);
  const j = direction === "left" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return; // já está na ponta

  [list[i], list[j]] = [list[j]!, list[i]!];

  await Promise.all(
    list.map((f, idx) =>
      db.from("field_definition").update({ position: idx }).eq("id", f.id),
    ),
  );
  revalidatePath("/board");
}

export async function toggleFieldOnCard(fieldId: string, show: boolean): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();
  const { error } = await db
    .from("field_definition")
    .update({ show_on_card_face: show })
    .eq("id", fieldId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/** Marca/desmarca "pedir na criação" (aparece no formulário genérico). */
export async function toggleFieldOnCreate(fieldId: string, show: boolean): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();
  const { error } = await db
    .from("field_definition")
    .update({ show_on_create: show })
    .eq("id", fieldId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/** Marca/desmarca "obrigatório" no formulário de criação. */
export async function toggleFieldRequired(fieldId: string, required: boolean): Promise<void> {
  const actor = await requireActor("field:manage");
  await assertFieldScope(actor, fieldId);
  const db = createAdminClient();
  const { error } = await db
    .from("field_definition")
    .update({ is_required: required })
    .eq("id", fieldId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function setFieldValue(
  cardId: string,
  fieldId: string,
  value: string | number | boolean | null,
): Promise<void> {
  const actor = await requireActor("card:update");
  await assertCardScope(actor, cardId);
  const db = createAdminClient();
  const { data: field } = await db
    .from("field_definition")
    .select("type, organization_id, name, allowed_editors")
    .eq("id", fieldId)
    .single();
  if (!field) throw new Error("Campo não encontrado.");

  // Alçada da propriedade: lista vazia = todos; senão, só quem está nela.
  const editors = (field.allowed_editors ?? []) as string[];
  if (editors.length > 0 && !editors.includes(actor.userId as string)) {
    throw new ForbiddenError(`Você não tem alçada para alterar "${field.name}".`);
  }

  const patch: Record<string, unknown> = {
    field_definition_id: fieldId,
    card_id: cardId,
    organization_id: field.organization_id,
    value_text: null,
    value_number: null,
    value_date: null,
    value_bool: null,
    value_member_id: null,
    value_json: null,
  };
  switch (field.type) {
    case "text":
    case "long_text":
    case "link":
    case "select":
    case "status":
      patch.value_text = value || null;
      break;
    case "number":
      patch.value_number = value === "" || value == null ? null : Number(value);
      break;
    case "date":
      patch.value_date = value || null;
      break;
    case "checkbox":
      patch.value_bool = Boolean(value);
      break;
    case "member":
      patch.value_member_id = value || null;
      break;
  }

  const { error } = await db
    .from("field_value")
    .upsert(patch, { onConflict: "field_definition_id,card_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

// ── Configuração de etapas (colunas) — só Gestor (board:configure) ───────────

export async function addStage(boardId: string, name: string): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertBoardScope(actor, boardId);
  const db = createAdminClient();
  const { data: board } = await db
    .from("board")
    .select("id, organization_id")
    .eq("id", boardId)
    .single();
  if (!board) throw new Error("Pipeline não encontrado.");
  const { data: last } = await db
    .from("stage")
    .select("position")
    .eq("board_id", board.id)
    .order("position", { ascending: false })
    .limit(1);
  const position = last?.[0] ? Number(last[0].position) + 1 : 0;
  const { error } = await db.from("stage").insert({
    organization_id: board.organization_id,
    board_id: board.id,
    name: name.trim() || "Nova etapa",
    position,
    category: "in_progress",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function renameStage(stageId: string, name: string): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const db = createAdminClient();
  const { error } = await db
    .from("stage")
    .update({ name: name.trim() || "Etapa" })
    .eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function setStageCategory(stageId: string, category: string): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const db = createAdminClient();
  const { error } = await db.from("stage").update({ category }).eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/**
 * Marca (ou desmarca) a etapa como "de emenda": cada vez que um card entra nela,
 * o contador de emendas do card sobe (gatilho da migration 0042).
 */
export async function setStageCountsRework(
  stageId: string,
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const { error } = await createAdminClient()
    .from("stage")
    .update({ counts_rework: on })
    .eq("id", stageId);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("counts_rework")
        ? "Falta aplicar a atualização do banco (migration 0042)."
        : "Não foi possível salvar. Tente de novo.",
    };
  }
  revalidatePath("/board");
  return { ok: true };
}

/** Define (ou remove, com null) o limite de cards em andamento da etapa. */
export async function setStageWipLimit(stageId: string, limit: number | null): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const value = limit != null && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
  const db = createAdminClient();
  const { error } = await db.from("stage").update({ wip_limit: value }).eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

export async function deleteStage(stageId: string): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const db = createAdminClient();
  const { count } = await db
    .from("card")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if ((count ?? 0) > 0) {
    throw new Error("Mova os cards desta etapa antes de removê-la.");
  }
  const { error } = await db.from("stage").delete().eq("id", stageId);
  if (error) throw new Error(error.message);
  revalidatePath("/board");
}

/** Troca a etapa de lugar com a vizinha (reordena as colunas). */
export async function reorderStage(stageId: string, direction: "left" | "right"): Promise<void> {
  const actor = await requireActor("stage:manage");
  await assertStageScope(actor, stageId);
  const db = createAdminClient();
  const { data: st } = await db.from("stage").select("board_id").eq("id", stageId).single();
  if (!st) throw new Error("Etapa não encontrada.");
  const { data: stages } = await db
    .from("stage")
    .select("id, position")
    .eq("board_id", st.board_id)
    .order("position");
  const list = stages ?? [];
  const idx = list.findIndex((s) => s.id === stageId);
  const swap = direction === "left" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx]!;
  const b = list[swap]!;
  await db.from("stage").update({ position: b.position }).eq("id", a.id);
  await db.from("stage").update({ position: a.position }).eq("id", b.id);
  revalidatePath("/board");
}

/** Remove o comentário — só o autor pode. */
export async function deleteComment(id: string): Promise<void> {
  const actor = await provisionAndGetActor();
  if (!actor) throw new Error("Sessão expirada.");
  const db = createAdminClient();
  const { data: c } = await db.from("comment").select("author_id").eq("id", id).maybeSingle();
  if (!c || c.author_id !== actor.userId) {
    throw new Error("Só o autor pode remover o comentário.");
  }
  await db.from("comment").delete().eq("id", id);
}
