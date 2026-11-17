import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPhone, normalizePhone, phoneVariants } from "./phone.ts";

test("telefone brasileiro em vários formatos vira E.164", () => {
  for (const raw of ["(84) 99999-8888", "84 99999 8888", "84999998888", "+55 84 99999-8888", "5584999998888", "084999998888"]) {
    assert.equal(normalizePhone(raw), "+5584999998888", raw);
  }
  assert.equal(normalizePhone("(84) 3222-1100"), "+558432221100");
});

test("telefone ilegível é recusado", () => {
  for (const raw of ["", "  ", "99999-8888", "123", "abc", "849999988889999"]) {
    assert.equal(normalizePhone(raw), null, raw);
  }
});

test("outro país só com o +", () => {
  assert.equal(normalizePhone("+1 (415) 555-2671"), "+14155552671");
  assert.equal(normalizePhone("+12"), null);
});

test("formatação e variantes com e sem o nono dígito", () => {
  assert.equal(formatPhone("+5584999998888"), "(84) 99999-8888");
  assert.equal(formatPhone("+14155552671"), "+14155552671");
  assert.deepEqual(phoneVariants("+5584999998888"), ["+5584999998888", "+558499998888"]);
  assert.deepEqual(phoneVariants("+558499998888"), ["+558499998888", "+5584999998888"]);
  assert.deepEqual(phoneVariants("+558432221100"), ["+558432221100"]);
});
