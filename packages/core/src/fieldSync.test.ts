import assert from "node:assert/strict";
import { test } from "node:test";

import { nextOptionIds, planFieldSync, type SyncField } from "./fieldSync.ts";

const opt = (id: string, label: string) => ({ id, label, color: "#000000" });
const f = (id: string, name: string, type: string, options: ReturnType<typeof opt>[] = []): SyncField => ({ id, name, type, options });

test("cria o que falta e não mexe no que já existe", () => {
  const plan = planFieldSync(
    [f("s1", "Segmento", "select", [opt("opt0", "Infantil")]), f("s2", "Link do autor", "link"), f("s3", "Início", "date")],
    [f("t1", "início", "date"), f("t9", "Só do destino", "text")],
  );
  assert.deepEqual(plan.create.map((x) => x.name), ["Segmento", "Link do autor"]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.addOptions, []);
  assert.deepEqual(plan.conflicts, []);
});

test("acrescenta só as opções que faltam, pelo rótulo, sem repetir id", () => {
  const plan = planFieldSync(
    [f("s1", "Tipo", "select", [opt("opt0", "Básico"), opt("opt1", "Up Grades"), opt("opt2", "Escrita do Zero")])],
    [f("t1", "TIPO", "status", [opt("opt0", "up grades"), opt("opt3", "Outro")])],
  );
  assert.equal(plan.addOptions.length, 1);
  assert.equal(plan.addOptions[0]!.targetId, "t1");
  assert.deepEqual(plan.addOptions[0]!.options.map((o) => [o.id, o.label]), [["opt4", "Básico"], ["opt5", "Escrita do Zero"]]);
});

test("mesmo nome com tipo incompatível vira conflito, não duplicata", () => {
  const plan = planFieldSync([f("s1", "Prazo interno", "date")], [f("t1", "Prazo interno", "text")]);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.conflicts, [{ name: "Prazo interno", sourceType: "date", targetType: "text" }]);
});

test("texto curto e longo são compatíveis; rodar de novo não muda nada", () => {
  const source = [f("s1", "Obs", "long_text"), f("s2", "Tipo", "select", [opt("opt0", "A")])];
  const target = [f("t1", "Obs", "text"), f("t2", "Tipo", "select", [opt("opt0", "A")])];
  const plan = planFieldSync(source, target);
  assert.equal(plan.unchanged, 2);
  assert.equal(plan.create.length + plan.addOptions.length + plan.conflicts.length, 0);
});

test("ids de opção continuam depois do maior existente", () => {
  assert.deepEqual(nextOptionIds([opt("opt0", "a"), opt("opt7", "b")], 2), ["opt8", "opt9"]);
  assert.deepEqual(nextOptionIds([], 2), ["opt0", "opt1"]);
});
