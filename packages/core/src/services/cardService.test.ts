import assert from "node:assert/strict";
import { test } from "node:test";

import { assertCan } from "../auth/policy.ts";
import type { Action, Actor, WorkflowRule } from "../domain/index.ts";
import { ForbiddenError, GateBlockedError, NotFoundError } from "../errors.ts";
import { asId } from "../ids.ts";
import type { CardFacts } from "./gates.ts";
import { CardService, type CardMovePort } from "./cardService.ts";

const NOW = () => "2027-01-01T00:00:00.000Z";

function actor(perms: Action[] = ["card:move"]): Actor {
  return {
    userId: asId("u"),
    organizationId: asId("o"),
    isInternal: true,
    permissions: new Set(perms),
    teamIds: [],
  };
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

function rule(partial: Partial<WorkflowRule>): WorkflowRule {
  return {
    id: "r1",
    organizationId: "o",
    boardId: "b",
    fromStageId: null,
    toStageId: "s2",
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

function port(overrides: Partial<CardMovePort> = {}): CardMovePort & { moved: string[] } {
  const moved: string[] = [];
  return {
    moved,
    getCard: async () => ({ boardId: "b", stageId: "s1" }),
    stageInBoard: async () => true,
    listRules: async () => [],
    getFacts: async () => facts(),
    applyMove: async (_c, to) => {
      moved.push(to);
    },
    ...overrides,
  };
}

test("sem regras → move e persiste", async () => {
  const p = port();
  const r = await new CardService(p, NOW).move(actor(), "c1", "s2");
  assert.equal(r.moved, true);
  assert.deepEqual(p.moved, ["s2"]);
});

test("mesma etapa → no-op", async () => {
  const p = port({ getCard: async () => ({ boardId: "b", stageId: "s2" }) });
  const r = await new CardService(p, NOW).move(actor(), "c1", "s2");
  assert.equal(r.moved, false);
  assert.deepEqual(p.moved, []);
});

test("gate block não satisfeito → GateBlockedError e NÃO move", async () => {
  const p = port({ listRules: async () => [rule({ requirement: "checklist_complete" })] });
  await assert.rejects(
    () => new CardService(p, NOW).move(actor(), "c1", "s2"),
    GateBlockedError,
  );
  assert.deepEqual(p.moved, []);
});

test("gate block satisfeito → move", async () => {
  const p = port({
    listRules: async () => [rule({ requirement: "checklist_complete" })],
    getFacts: async () => facts({ checklistComplete: true }),
  });
  const r = await new CardService(p, NOW).move(actor(), "c1", "s2");
  assert.equal(r.moved, true);
});

test("gate warn → move com aviso", async () => {
  const p = port({
    listRules: async () => [rule({ requirement: "attachment_present", enforcement: "warn" })],
  });
  const r = await new CardService(p, NOW).move(actor(), "c1", "s2");
  assert.equal(r.moved, true);
  assert.equal(r.warnings.length, 1);
});

test("card inexistente → NotFound", async () => {
  const p = port({ getCard: async () => null });
  await assert.rejects(() => new CardService(p, NOW).move(actor(), "c1", "s2"), NotFoundError);
});

test("etapa fora do board → NotFound", async () => {
  const p = port({ stageInBoard: async () => false });
  await assert.rejects(() => new CardService(p, NOW).move(actor(), "c1", "s2"), NotFoundError);
});

test("ator sem permissão card:move → Forbidden", async () => {
  const p = port();
  await assert.rejects(
    () => new CardService(p, NOW).move(actor([]), "c1", "s2"),
    ForbiddenError,
  );
  assert.deepEqual(p.moved, []);
});

// sanity: helper de policy exposto
test("assertCan é reexportado", () => {
  assert.doesNotThrow(() => assertCan(actor(), "card:move"));
});
