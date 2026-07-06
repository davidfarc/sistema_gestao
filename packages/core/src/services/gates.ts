/**
 * Avaliação de gates (workflow_rule) para uma transição de etapa.
 *
 * Função PURA: recebe as regras ativas da transição + um retrato dos fatos do
 * card e diz o que bloqueia (enforcement=block) e o que só avisa (warn).
 * O CardService injeta os fatos (lidos via ports) e chama isto — assim o gate
 * é avaliado em UM lugar só, no servidor, e é testável sem banco.
 */

import type { RequirementKind, WorkflowRule } from "../domain/index.ts";

/** Retrato dos fatos do card necessários para avaliar qualquer requisito. */
export interface CardFacts {
  checklistComplete: boolean;
  hasAttachment: boolean;
  filledFieldIds: ReadonlySet<string>;
  hasConcludedEmenda: boolean;
  hasApproval: boolean;
  actorHasRole: (roleId: string) => boolean;
}

export interface RuleViolation {
  ruleId: string;
  requirement: RequirementKind;
  message: string;
}

export interface GateResult {
  /** true se houver ao menos uma regra block não satisfeita. */
  blocked: boolean;
  violations: RuleViolation[]; // enforcement=block não satisfeitas
  warnings: RuleViolation[]; // enforcement=warn não satisfeitas
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Um requisito está satisfeito pelos fatos do card? */
function requirementMet(rule: WorkflowRule, facts: CardFacts): boolean {
  switch (rule.requirement) {
    case "checklist_complete":
      return facts.checklistComplete;
    case "attachment_present":
      return facts.hasAttachment;
    case "field_filled": {
      const fieldId = asString(rule.requirementConfig["fieldDefinitionId"]);
      return fieldId !== undefined && facts.filledFieldIds.has(fieldId);
    }
    case "emenda_concluded":
      return facts.hasConcludedEmenda;
    case "approval":
      return facts.hasApproval;
    case "role": {
      const roleId = asString(rule.requirementConfig["roleId"]);
      return roleId !== undefined && facts.actorHasRole(roleId);
    }
    default: {
      const _exhaustive: never = rule.requirement;
      return _exhaustive;
    }
  }
}

const MESSAGES: Record<RequirementKind, string> = {
  checklist_complete: "Complete o checklist antes de avançar.",
  attachment_present: "Anexe o documento antes de avançar.",
  field_filled: "Preencha o campo obrigatório antes de avançar.",
  emenda_concluded: "A emenda precisa estar concluída antes de avançar.",
  approval: "Falta a aprovação necessária.",
  role: "Você não tem o papel necessário para esta transição.",
};

/**
 * Avalia todas as regras ATIVAS de uma transição. (Assume que o chamador já
 * filtrou por is_active e pela transição from→to correta.)
 */
export function evaluateGates(
  rules: readonly WorkflowRule[],
  facts: CardFacts,
): GateResult {
  const violations: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (requirementMet(rule, facts)) continue;
    const violation: RuleViolation = {
      ruleId: rule.id,
      requirement: rule.requirement,
      message: MESSAGES[rule.requirement],
    };
    if (rule.enforcement === "block") violations.push(violation);
    else warnings.push(violation);
  }

  return { blocked: violations.length > 0, violations, warnings };
}
