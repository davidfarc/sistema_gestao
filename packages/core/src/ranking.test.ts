import assert from "node:assert/strict";
import { test } from "node:test";

import {
  firstPosition,
  positionAfter,
  positionBefore,
  positionBetween,
} from "./ranking.js";

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
