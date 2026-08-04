import assert from "node:assert/strict";
import { test } from "node:test";

import {
  budgetEffortScore,
  effortScore,
  parseDecimal,
  riceScore,
  scoreFromLabel,
} from "./alcadas.ts";

test("parseDecimal aceita vírgula decimal (rótulos são pt-BR)", () => {
  assert.equal(parseDecimal("0,25"), 0.25);
  assert.equal(parseDecimal("0.25"), 0.25);
  assert.equal(parseDecimal("2"), 2);
  assert.equal(parseDecimal(" 1,5 "), 1.5);
});

test("parseDecimal devolve null para vazio ou texto inválido", () => {
  assert.equal(parseDecimal(""), null);
  assert.equal(parseDecimal("   "), null);
  assert.equal(parseDecimal("abc"), null);
  assert.equal(parseDecimal(null), null);
  assert.equal(parseDecimal(undefined), null);
});

test("RICE calcula com os 4 componentes", () => {
  // (100 × 2 × 0,80) / 4 = 40
  assert.equal(riceScore({ reach: 100, impact: 2, confidence: 80, effort: 4 }), 40);
});

test("RICE é null quando falta componente ou o esforço é zero", () => {
  assert.equal(riceScore({ reach: 100, impact: 2, confidence: 80, effort: null }), null);
  assert.equal(riceScore({ reach: 100, impact: 2, confidence: 80, effort: 0 }), null);
});

test("scoreFromLabel lê o número antes da descrição", () => {
  // Rótulos explicativos não podem quebrar o cálculo (era o bug do NaN).
  assert.equal(scoreFromLabel("0,25 — Mínimo"), 0.25);
  assert.equal(scoreFromLabel("3 — Múltiplas áreas + critérios técnicos"), 3);
  assert.equal(scoreFromLabel("2"), 2); // rótulo só com o número
  assert.equal(scoreFromLabel(""), null);
  assert.equal(scoreFromLabel(null), null);
});

test("orçamento vira score pelas faixas do manual", () => {
  assert.equal(budgetEffortScore(9_000), 1);
  assert.equal(budgetEffortScore(10_000), 1); // limite inclusivo
  assert.equal(budgetEffortScore(30_000), 2);
  assert.equal(budgetEffortScore(50_000), 2);
  assert.equal(budgetEffortScore(73_000), 3); // tabela manda 3 (o exemplo diz 2)
  assert.equal(budgetEffortScore(null), null);
});

test("esforço é a SOMA das três parcelas (exemplo do telhado)", () => {
  // Manual: tempo 2 + complexidade 4 + orçamento 2 = 8.
  assert.equal(effortScore({ tempoMeses: 2, complexidade: 4, orcamentoScore: 2 }), 8);
  // Demanda rápida com score decimal de tempo.
  assert.equal(effortScore({ tempoMeses: 0.5, complexidade: 1, orcamentoScore: 1 }), 2.5);
});

test("esforço é null enquanto faltar uma parcela", () => {
  assert.equal(effortScore({ tempoMeses: 2, complexidade: 4, orcamentoScore: null }), null);
  assert.equal(effortScore({ tempoMeses: null, complexidade: 4, orcamentoScore: 2 }), null);
});

test("RICE NÃO propaga NaN — o bug do impacto '0,25' virando NaN", () => {
  // Number("0,25") = NaN; antes isso vazava para a tela como "NaN".
  assert.equal(riceScore({ reach: 20, impact: Number("0,25"), confidence: 50, effort: 4 }), null);
  // Com o parser certo, calcula: (20 × 0,25 × 0,5) / 4 = 0,625
  assert.equal(
    riceScore({ reach: 20, impact: parseDecimal("0,25"), confidence: 50, effort: 4 }),
    0.625,
  );
});
