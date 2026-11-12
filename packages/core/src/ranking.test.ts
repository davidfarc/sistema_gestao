import assert from "node:assert/strict";
import { test } from "node:test";

import {
  firstPosition,
  placeInColumn,
  placementIndex,
  positionAfter,
  positionBefore,
  positionBetween,
} from "./ranking.ts";

test("firstPosition em coluna vazia", () => {
  assert.equal(firstPosition(), 1000);
});

test("append no fim avança um passo", () => {
  assert.equal(positionAfter(1000), 2000);
});

test("insert no topo divide ao meio", () => {
  assert.equal(positionBefore(1000), 500);
});

test("between dois vizinhos = ponto médio", () => {
  assert.equal(positionBetween(1000, 2000), 1500);
});

test("between com vizinho nulo cai nos extremos", () => {
  assert.equal(positionBetween(null, 2000), 1000);
  assert.equal(positionBetween(1000, null), 2000);
  assert.equal(positionBetween(null, null), 1000);
});

test("between exige before < after", () => {
  assert.throws(() => positionBetween(2000, 1000), RangeError);
});

// ── placeInColumn ───────────────────────────────────────────────────────────

const col = (...ps: number[]) => ps.map((position, i) => ({ id: `c${i + 1}`, position }));

test("placementIndex: depois de beforeId, senão antes de afterId, senão no fim", () => {
  const ids = ["a", "b", "c"];
  assert.equal(placementIndex(ids, { beforeId: "a", afterId: "b" }), 1);
  assert.equal(placementIndex(ids, { beforeId: "x", afterId: "c" }), 2);
  assert.equal(placementIndex(ids, { beforeId: null, afterId: "a" }), 0);
  assert.equal(placementIndex(ids, { beforeId: null, afterId: null }), 3);
});

test("soltar entre dois vizinhos grava só o ponto médio", () => {
  const r = placeInColumn(col(1000, 2000, 3000), "novo", { beforeId: "c1", afterId: "c2" });
  assert.deepEqual(r, { kind: "single", position: 1500 });
});

test("soltar no topo e no fim", () => {
  assert.deepEqual(placeInColumn(col(1000, 2000), "novo", { beforeId: null, afterId: "c1" }), {
    kind: "single",
    position: 500,
  });
  assert.deepEqual(placeInColumn(col(1000, 2000), "novo", { beforeId: "c2", afterId: null }), {
    kind: "single",
    position: 3000,
  });
});

test("coluna vazia recebe a primeira posição", () => {
  assert.deepEqual(placeInColumn([], "novo", { beforeId: null, afterId: null }), {
    kind: "single",
    position: 1000,
  });
});

test("reordenar dentro da coluna ignora a posição antiga do próprio card", () => {
  // c1 desce para depois de c3.
  const r = placeInColumn(col(1000, 2000, 3000), "c1", { beforeId: "c3", afterId: null });
  assert.deepEqual(r, { kind: "single", position: 4000 });
});

test("vizinhos empatados (cards antigos, todos em 1000) renumeram a coluna", () => {
  const r = placeInColumn(col(1000, 1000, 1000), "c3", { beforeId: "c1", afterId: "c2" });
  assert.deepEqual(r, {
    kind: "rebalance",
    positions: [
      { id: "c1", position: 1000 },
      { id: "c3", position: 2000 },
      { id: "c2", position: 3000 },
    ],
  });
});

test("vizinho visível fora da coluna (filtro ligado) cai no outro vizinho", () => {
  const r = placeInColumn(col(1000, 2000), "novo", { beforeId: "sumiu", afterId: "c2" });
  assert.deepEqual(r, { kind: "single", position: 1500 });
});

test("intervalo esgotado entre vizinhos renumera", () => {
  const a = 1000;
  const b = a + 2 ** -43; // o número representável logo acima de 1000
  const r = placeInColumn(
    [
      { id: "a", position: a },
      { id: "b", position: b },
    ],
    "novo",
    { beforeId: "a", afterId: "b" },
  );
  assert.equal(r.kind, "rebalance");
});
