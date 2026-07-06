import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowRule } from "../domain/index.ts";
import { evaluateGates, type CardFacts } from "./gates.ts";

function rule(partial: Partial<WorkflowRule>): WorkflowRule {
  return {
    id: "r1",
    organizationId: "o",
    boardId: "b",
    fromStageId: null,
    toStageId: "s",
    requirement: "checklist_complete",
    requirementConfig: {},
    enforcement: "block",
    isActive: true,
    createdAt: "",
    updatedAt: "",
    archivedAt: null,
    ...partial,
  } as WorkflowRule;
}

function facts(partial: Partial<CardFacts> = {}): CardFacts {
  return {
    checklistComplete: false,
    hasAttachment: false,
    filledFieldIds: new Set<string>(),
    hasConcludedEmenda: false,
    hasApproval: false,
    actorHasRole: () => false,
    ...partial,
  };
}

test("sem regras → não bloqueia", () => {
  const r = evaluateGates([], facts());
  assert.equal(r.blocked, false);
  assert.equal(r.violations.length, 0);
});

test("checklist incompleto com enforcement=block → bloqueia", () => {
  const r = evaluateGates([rule({ requirement: "checklist_complete" })], facts());
  assert.equal(r.blocked, true);
  assert.equal(r.violations.length, 1);
});

test("checklist completo → libera", () => {
  const r = evaluateGates(
    [rule({ requirement: "checklist_complete" })],
    facts({ checklistComplete: true }),
  );
  assert.equal(r.blocked, false);
});

test("enforcement=warn não bloqueia, vira aviso", () => {
  const r = evaluateGates(
    [rule({ requirement: "attachment_present", enforcement: "warn" })],
    facts(),
  );
  assert.equal(r.blocked, false);
  assert.equal(r.warnings.length, 1);
});

test("field_filled respeita o fieldDefinitionId da config", () => {
  const req = rule({
    requirement: "field_filled",
    requirementConfig: { fieldDefinitionId: "f1" },
  });
  assert.equal(evaluateGates([req], facts()).blocked, true);
  assert.equal(
    evaluateGates([req], facts({ filledFieldIds: new Set(["f1"]) })).blocked,
    false,
  );
});

test("regra inativa é ignorada", () => {
  const r = evaluateGates([rule({ isActive: false })], facts());
  assert.equal(r.blocked, false);
});
