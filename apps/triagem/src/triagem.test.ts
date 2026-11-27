import assert from "node:assert/strict";
import { test } from "node:test";

import { handleRequest, runTick, type Deps, type Env } from "./index.ts";
import { parseVilaEvent } from "./parse.ts";

const SECRET = "t".repeat(40);
const upsert = (key: Record<string, unknown> = {}, message: Record<string, unknown> = { conversation: "Bom dia" }, instance = "Gestão Vila-2") => ({
  event: "messages.upsert",
  instance,
  data: { key: { remoteJid: "558499998888@s.whatsapp.net", fromMe: false, id: "M1", ...key }, message, messageTimestamp: 1795700000 },
});
const post = (body: unknown, path = `/webhook/${SECRET}`) =>
  new Request(`https://triagem.exemplo${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

function deps() {
  const log: Record<string, unknown>[] = [];
  const d: Deps = { webhookSecret: SECRET, instance: "Gestão Vila-2", record: async (a) => (log.push(a), { ok: true }) };
  return { d, log };
}

test("lê as duas direções: família e resposta da equipe pelo celular", () => {
  const fam = parseVilaEvent(upsert())!;
  assert.equal(fam.fromFamily, true);
  assert.equal(fam.phone, "+558499998888");
  assert.equal(fam.at, new Date(1795700000 * 1000).toISOString());
  const team = parseVilaEvent(upsert({ fromMe: true, id: "M2" }, { conversation: "Vamos verificar" }))!;
  assert.equal(team.fromFamily, false);
});

test("ignora grupos, status, reações e figurinhas", () => {
  assert.equal(parseVilaEvent(upsert({ remoteJid: "120363@g.us" })), null);
  assert.equal(parseVilaEvent(upsert({ remoteJid: "status@broadcast" })), null);
  assert.equal(parseVilaEvent(upsert({}, { reactionMessage: { text: "👍" } })), null);
  assert.equal(parseVilaEvent(upsert({}, { stickerMessage: {} })), null);
  assert.equal(parseVilaEvent(upsert({}, { audioMessage: {} }))!.kind, "audio");
});

test("webhook: senha certa e só a instância da Vila; o Luix nunca entra", async () => {
  const a = deps();
  assert.equal((await handleRequest(post(upsert(), "/webhook/errada"), a.d)).status, 401);
  assert.equal(await (await handleRequest(post(upsert({}, undefined, "Eccoprime Zap")), a.d)).text(), "ignorado");
  assert.equal(a.log.length, 0);
  assert.equal(await (await handleRequest(post(upsert()), a.d)).text(), "ok");
  assert.equal(a.log.length, 1);
  assert.deepEqual(a.log[0]!.p_phones, ["+558499998888", "+5584999998888"]);
  assert.equal(a.log[0]!.p_from_family, true);
});

test("rodada: classifica o pendente, grava com a versão do prompt e roda o relógio", async () => {
  const calls: [string, any][] = [];
  const env = { OPENAI_API_KEY: "k", OPENAI_MODEL: "m" } as Env;
  const r = await runTick(
    env,
    async (fn, args) => {
      calls.push([fn, args]);
      if (fn === "triage_to_classify") return [{ episodio: "e1", upto: "2026-11-27T10:00:00Z", turnos: [] }];
      if (fn === "triage_tick") return 2;
      return { ok: true };
    },
    async () => ({ assunto: ["pedagogico"], acao: "pede_resposta", gravidade: "alta", risco_escalar: "medio", queixa_formal: true, confianca: "alta", motivo_direcao: "x" }),
  );
  assert.deepEqual(r, { classificadas: 1, avisos: 2 });
  assert.deepEqual(calls.map((c) => c[0]), ["triage_to_classify", "triage_save", "triage_tick"]);
  assert.equal(calls[1]![1].p_version, "v3-wa");
});
