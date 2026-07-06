/**
 * CardService.move — o ÚNICO caminho de movimentação de card (decisão ⑤ do PLANO).
 * Orquestra: autoriza o ator → valida a etapa destino → carrega as regras ativas
 * da transição → junta os fatos do card → avalia os gates → só então move.
 *
 * O serviço é PURO em relação à infraestrutura: toda I/O entra pela porta
 * `CardMovePort`, implementada por um adaptador (Supabase). Assim ele é testável
 * sem banco e o gate fica não-burlável (toda escrita de etapa passa por aqui).
 */

import { assertCan } from "../auth/policy.ts";
import type { Actor, WorkflowRule } from "../domain/index.ts";
import { GateBlockedError, NotFoundError } from "../errors.ts";
import { evaluateGates, type CardFacts, type RuleViolation } from "./gates.ts";

export interface CardMovePort {
  /** Localização atual do card (ou null se não existe). */
  getCard(cardId: string): Promise<{ boardId: string; stageId: string } | null>;
  /** A etapa destino existe e pertence ao mesmo board? */
  stageInBoard(stageId: string, boardId: string): Promise<boolean>;
  /** Regras ATIVAS que se aplicam à transição from→to. */
  listRules(boardId: string, fromStageId: string, toStageId: string): Promise<WorkflowRule[]>;
  /** Fatos do card para avaliar os requisitos dos gates. */
  getFacts(cardId: string): Promise<CardFacts>;
  /** Aplica o move (stage + stage_entered_at). */
  applyMove(cardId: string, toStageId: string, enteredAtIso: string): Promise<void>;
}

export interface MoveResult {
  moved: boolean;
  /** Avisos (gates enforcement=warn não satisfeitos) — não bloqueiam. */
  warnings: RuleViolation[];
}

export class CardService {
  private readonly port: CardMovePort;
  private readonly now: () => string;

  constructor(port: CardMovePort, now: () => string) {
    this.port = port;
    this.now = now;
  }

  async move(actor: Actor, cardId: string, toStageId: string): Promise<MoveResult> {
    assertCan(actor, "card:move");

    const card = await this.port.getCard(cardId);
    if (!card) throw new NotFoundError("Card não encontrado.");

    if (card.stageId === toStageId) return { moved: false, warnings: [] };

    if (!(await this.port.stageInBoard(toStageId, card.boardId))) {
      throw new NotFoundError("Etapa inválida.");
    }

    const rules = await this.port.listRules(card.boardId, card.stageId, toStageId);
    const facts = await this.port.getFacts(cardId);
    const gate = evaluateGates(rules, facts);

    if (gate.blocked) {
      throw new GateBlockedError("Transição bloqueada por um gate.", gate.violations);
    }

    await this.port.applyMove(cardId, toStageId, this.now());
    return { moved: true, warnings: gate.warnings };
  }
}
