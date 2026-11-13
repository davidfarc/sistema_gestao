/**
 * Estado local do quadro: funções puras que aplicam na lista de cards da tela
 * o mesmo efeito que a gravação terá no banco. É o que permite a tela mudar na
 * hora, sem refazer as consultas do quadro a cada clique (SPEC-FASE2 A9).
 */

import { firstPosition, placeInColumn, positionAfter, type Placement } from "@ecco/core";

import { memberView } from "./avatar";
import { resolveChip } from "./chips";
import type { CardPageData, CardView, FieldChip, MemberOption } from "./types";

/** Ordem de exibição: posição e, no empate, número — a mesma do `loadBoard`. */
export function sortCards(cards: CardView[]): CardView[] {
  return [...cards].sort((a, b) => a.position - b.position || a.number - b.number);
}

/** Recalcula o selo "Aguarda priorização" depois de uma troca de etapa. */
function withStage(card: CardView, stageId: string, gated: ReadonlySet<string>): CardView {
  return {
    ...card,
    stageId,
    awaitingPrioritization: gated.has(stageId) && !card.prioritized,
  };
}

/**
 * Move o card para `toStageId`, na posição `placement` (sem ela: fim da
 * coluna). Usa o mesmo `placeInColumn` do servidor, então o resultado bate com
 * o que será gravado.
 */
export function applyMove(
  cards: CardView[],
  cardId: string,
  toStageId: string,
  placement: Placement | undefined,
  gated: ReadonlySet<string>,
): CardView[] {
  const moving = cards.find((c) => c.id === cardId);
  if (!moving) return cards;
  const column = sortCards(cards.filter((c) => c.stageId === toStageId && c.id !== cardId));

  const positions = new Map<string, number>();
  if (placement) {
    const result = placeInColumn(column, cardId, placement);
    if (result.kind === "single") positions.set(cardId, result.position);
    else for (const p of result.positions) positions.set(p.id, p.position);
  } else {
    const last = column[column.length - 1];
    positions.set(cardId, last ? positionAfter(last.position) : firstPosition());
  }

  return sortCards(
    cards.map((c) => {
      const position = positions.get(c.id) ?? c.position;
      if (c.id === cardId) return { ...withStage(c, toStageId, gated), position };
      return position === c.position ? c : { ...c, position };
    }),
  );
}

/** Linha de `card` que chega pelo Realtime (só as colunas que a tela usa). */
export interface CardRow {
  id: string;
  number: number | string;
  title: string;
  stage_id: string;
  due_date: string | null;
  position: number | string;
  requester_id: string | null;
  archived_at?: string | null;
  /** Emendas (migration 0042); ausente antes dela. */
  rework_count?: number | null;
}

/**
 * Aplica uma alteração de card vinda do Realtime. Devolve null quando a tela
 * não tem como resolver sozinha (card desconhecido ou solicitante trocado, que
 * exige o nome da pessoa) — aí quem chama recarrega do servidor.
 */
export function applyCardRow(
  cards: CardView[],
  row: CardRow,
  gated: ReadonlySet<string>,
): CardView[] | null {
  const current = cards.find((c) => c.id === row.id);
  if (!current) return null;
  if ((current.requester?.id ?? null) !== (row.requester_id ?? null)) return null;
  const position = Number(row.position);
  if (
    current.title === row.title &&
    current.stageId === row.stage_id &&
    current.dueDate === row.due_date &&
    current.position === position &&
    (row.rework_count == null || current.reworkCount === undefined || current.reworkCount === row.rework_count)
  ) {
    return cards; // eco de uma mudança que esta tela mesma já aplicou
  }
  return sortCards(
    cards.map((c) =>
      c.id === row.id
        ? {
            ...withStage(c, row.stage_id, gated),
            title: row.title,
            dueDate: row.due_date,
            position,
            ...(row.rework_count != null && c.reworkCount !== undefined
              ? { reworkCount: Number(row.rework_count) }
              : {}),
          }
        : c,
    ),
  );
}

/**
 * Card novo vindo do Realtime (criado por outra pessoa ou em outra aba).
 * Só dá para montar na tela se o solicitante já aparece em algum card do
 * quadro (de onde sai o nome); senão devolve null e quem chama recarrega.
 */
export function cardFromRow(
  cards: CardView[],
  row: CardRow,
  gated: ReadonlySet<string>,
): CardView | null {
  let requester: CardView["requester"] = null;
  if (row.requester_id) {
    for (const c of cards) {
      const known = [c.requester, c.assignee].find((m) => m?.id === row.requester_id);
      if (known) {
        requester = known;
        break;
      }
    }
    if (!requester) return null;
  }
  return {
    id: row.id,
    number: Number(row.number),
    title: row.title,
    stageId: row.stage_id,
    position: Number(row.position),
    assignee: null,
    requester,
    labels: [],
    dueDate: row.due_date,
    status: null,
    fields: [],
    checklist: null,
    commentCount: 0,
    awaitingPrioritization: gated.has(row.stage_id),
    prioritized: false,
  };
}

function memberOf(id: string | null, members: MemberOption[]) {
  if (!id) return null;
  return memberView(id, members.find((m) => m.id === id)?.name ?? "?");
}

/** O que muda na face do card a partir do card completo (painel aberto). */
export function faceFromPage(data: CardPageData): Partial<CardView> {
  const d = data.detail;
  const items = d.checklists.flatMap((l) => l.items);
  const nameOf = (id: string) => d.members.find((m) => m.id === id)?.name;
  const fields: FieldChip[] = [];
  for (const f of data.fields) {
    if (!f.showOnCardFace) continue;
    const chip = resolveChip(f, data.values[f.id], nameOf);
    if (chip) fields.push(chip);
  }
  return {
    title: data.title,
    assignee: memberOf(d.responsibleId, d.members),
    requester: memberOf(d.requesterId, d.members),
    checklist: items.length > 0 ? { done: items.filter((i) => i.done).length, total: items.length } : null,
    commentCount: d.comments.length,
    fields,
  };
}
