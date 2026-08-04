import { cache } from "react";

import { parseThresholds, type Thresholds } from "@ecco/core";
import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseIntake, type CreationForm, type FieldDef, type Intake } from "@/lib/board/types";

/**
 * Caixa de entrada: abrir o formulário de um pipeline que a pessoa não enxerga.
 *
 * Tudo aqui roda com a chave de serviço, que ignora a RLS — por isso cada
 * função checa o acesso explicitamente e devolve o MENOR conjunto possível:
 * o esqueleto do formulário (nome do pipeline, modo, campos). Nunca cards,
 * valores ou comentários.
 */

/** Esqueleto do formulário — o suficiente para renderizar, nada além. */
export interface IntakeForm {
  boardId: string;
  boardName: string;
  creationForm: CreationForm;
  thresholds: Thresholds;
  fields: FieldDef[];
}

interface BoardAccess {
  organizationId: string;
  intake: Intake;
  /** A pessoa enxerga o pipeline (é Gestor ou membro dele)? */
  isMember: boolean;
  /** A caixa de entrada está aberta para esta pessoa? */
  intakeAllowed: boolean;
}

/** Lê o pipeline e a relação da pessoa logada com ele. Null se não existir. */
const boardAccess = cache(async (boardId: string): Promise<BoardAccess | null> => {
  const actor = await requireActor();
  const db = createAdminClient();

  const { data: board } = await db
    .from("board")
    .select("id, organization_id, intake, intake_user_ids")
    .eq("id", boardId)
    .is("archived_at", null)
    .maybeSingle();

  // Pipeline de outra organização é tratado como inexistente: responder
  // "sem permissão" já confirmaria que aquele id existe.
  if (!board || board.organization_id !== actor.organizationId) return null;

  let isMember = actor.permissions.has("board:configure");
  if (!isMember) {
    const { data: m } = await db
      .from("board_member")
      .select("board_id")
      .eq("board_id", boardId)
      .eq("user_id", actor.userId as string)
      .maybeSingle();
    isMember = !!m;
  }

  // Externo entra por atribuição, nunca pela caixa de entrada.
  const intake = parseIntake(board.intake);
  const listados = (board.intake_user_ids as string[] | null) ?? [];
  const intakeAllowed =
    actor.isInternal &&
    (intake === "org" || (intake === "users" && listados.includes(actor.userId as string)));

  return {
    organizationId: board.organization_id,
    intake,
    isMember,
    intakeAllowed,
  };
});

/**
 * A pessoa pode criar card neste pipeline?
 *
 * Existe porque as actions de criação escrevem com a chave de serviço: sem esta
 * checagem, qualquer pessoa com `card:create` cria card em qualquer pipeline
 * cujo id descubra, inclusive nos que não enxerga. A permissão diz "pode criar
 * cards"; esta função diz "pode criar AQUI".
 */
export async function assertCanCreateInBoard(boardId: string): Promise<void> {
  await requireActor("card:create");
  const access = await boardAccess(boardId);
  if (!access) throw new Error("Pipeline não encontrado.");
  if (!access.isMember && !access.intakeAllowed) {
    throw new Error("Você não tem acesso para criar demandas neste pipeline.");
  }
}

/**
 * Esqueleto do formulário para quem NÃO enxerga o pipeline mas pode usar a
 * caixa de entrada. Devolve null quando não é o caso — inclusive para quem
 * enxerga o quadro, que segue pelo caminho normal.
 */
export async function loadIntakeForm(boardId: string): Promise<IntakeForm | null> {
  const actor = await requireActor();
  const access = await boardAccess(boardId);
  if (!access || access.isMember) return null;
  if (!access.intakeAllowed) return null;
  if (!actor.permissions.has("card:create")) return null;

  const db = createAdminClient();
  const [{ data: board }, { data: fields }] = await Promise.all([
    db.from("board").select("name, creation_form, alcada_thresholds").eq("id", boardId).maybeSingle(),
    db
      .from("field_definition")
      .select(
        "id, name, type, config, show_on_card_face, show_on_create, is_required, position, board_id, allowed_editors",
      )
      .or(`board_id.eq.${boardId},board_id.is.null`)
      .eq("organization_id", access.organizationId)
      .order("position"),
  ]);
  if (!board) return null;

  return {
    boardId,
    boardName: board.name,
    creationForm: (board.creation_form ?? "simple") as CreationForm,
    thresholds: parseThresholds(board.alcada_thresholds),
    // Mesmo mapeamento de `loadFields`; só a origem muda (admin em vez de RLS).
    fields: (fields ?? []).map((f) => ({
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
    })),
  };
}
