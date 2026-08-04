import assert from "node:assert/strict";
import { test } from "node:test";

import { businessDaysBetween, slaLevelOf, slaLimitDays, slaStatus } from "./sla.ts";

test("classifica a urgência pelos rótulos reais do formulário", () => {
  assert.equal(slaLevelOf("Muito alta (0–48h)"), "muito_alta");
  assert.equal(slaLevelOf("Alta (até 7 dias)"), "alta");
  assert.equal(slaLevelOf("Normal (8–30 dias)"), "normal");
  assert.equal(slaLevelOf("Baixa (30+ dias)"), "baixa");
  assert.equal(slaLevelOf("Muito baixa (sem pressa)"), "muito_baixa");
});

test('"muito alta" não cai em "alta" (nem "muito baixa" em "baixa")', () => {
  assert.equal(slaLimitDays("Muito alta (0–48h)"), 2);
  assert.equal(slaLimitDays("Alta (até 7 dias)"), 7);
  assert.equal(slaLimitDays("Muito baixa (sem pressa)"), 180);
  assert.equal(slaLimitDays("Baixa (30+ dias)"), 90);
});

test("sem urgência definida vira Normal", () => {
  assert.equal(slaLimitDays(null), 30);
  assert.equal(slaLimitDays(""), 30);
});

test("dias úteis pulam o fim de semana", () => {
  // 2026-07-06 é uma segunda; até a segunda seguinte = 5 dias úteis.
  assert.equal(businessDaysBetween("2026-07-06", "2026-07-13"), 5);
  // Sexta → segunda = 1 dia útil (sábado e domingo não contam).
  assert.equal(businessDaysBetween("2026-07-10", "2026-07-13"), 1);
  assert.equal(businessDaysBetween("2026-07-06", "2026-07-06"), 0);
});

test("status: dentro do prazo", () => {
  const s = slaStatus("Normal (8–30 dias)", "2026-07-06", "2026-07-13");
  assert.equal(s.limitDays, 30);
  assert.equal(s.elapsedDays, 5);
  assert.equal(s.remainingDays, 25);
  assert.equal(s.late, false);
});

test("status: atrasado dá dias negativos", () => {
  const s = slaStatus("Muito alta (0–48h)", "2026-07-06", "2026-07-13");
  assert.equal(s.limitDays, 2);
  assert.equal(s.elapsedDays, 5);
  assert.equal(s.remainingDays, -3);
  assert.equal(s.late, true);
  assert.equal(s.progress, 1); // satura
});
