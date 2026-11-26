import assert from "node:assert/strict";
import { test } from "node:test";

import { describeIgnored, parseInbound, sendText } from "./evolution.ts";
import { handleRequest, replyFor, safeEqual, type Deps, type InboundResult } from "./handler.ts";

const SECRET = "s".repeat(40);

const upsert = (over: Record<string, unknown> = {}, key: Record<string, unknown> = {}) => ({
  event: "messages.upsert",
  instance: "Eccoprime Zap",
  data: {
    key: { remoteJid: "558499998888@s.whatsapp.net", fromMe: false, id: "ABC123", ...key },
    pushName: "Fulana",
    message: { conversation: "O ar da sala 12 não liga" },
    ...over,
  },
});

function deps(result: Partial<InboundResult> | null = {}, sendError: string | null = null) {
  const log = { inbound: [] as unknown[], sent: [] as [string, string][], out: [] as unknown[] };
  const d: Deps = {
    webhookSecret: SECRET,
    appUrl: "https://gestao.exemplo.com",
    async recordInbound(msg, phones) {
      log.inbound.push({ msg, phones });
      return result === null
        ? null
        : { duplicada: false, usuario: null, recentes: 1, minutos_desde_resposta: null, ...result };
    },
    async recordOutbound(...a) {
      log.out.push(a);
    },
    async send(phone, text) {
      log.sent.push([phone, text]);
      return sendError;
    },
  };
  return { d, log };
}

const post = (body: unknown, path = `/webhook/${SECRET}`, headers: Record<string, string> = {}) =>
  new Request(`https://zap.exemplo${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("parseInbound lê texto simples e texto estendido", () => {
  assert.deepEqual(parseInbound(upsert()), {
    phone: "+558499998888",
    providerId: "ABC123",
    chatJid: "558499998888@s.whatsapp.net",
    kind: "text",
    text: "O ar da sala 12 não liga",
  });
  assert.equal(parseInbound(upsert({ message: { extendedTextMessage: { text: " oi " } } }))?.text, "oi");
  assert.equal(parseInbound({ ...upsert(), event: "MESSAGES_UPSERT" })?.kind, "text");
});

test("parseInbound reconhece áudio e outros tipos", () => {
  const audio = parseInbound(upsert({ message: { audioMessage: { url: "x", seconds: 7, mimetype: "audio/ogg; codecs=opus" } } }));
  assert.equal(audio?.kind, "audio");
  assert.equal(audio?.seconds, 7);
  assert.equal((audio?.media?.key as { id: string }).id, "ABC123");
  assert.deepEqual(audio?.media?.message, { audioMessage: { url: "x", seconds: 7, mimetype: "audio/ogg; codecs=opus" } });
  assert.equal(parseInbound(upsert({ message: { audioMessage: {}, base64: "QUJD" } }))?.media?.base64, "QUJD");
  const image = parseInbound(upsert({ message: { imageMessage: { caption: " foto do ar ", mimetype: "image/png" } } }));
  assert.equal(image?.kind, "image");
  assert.equal(image?.text, "foto do ar");
  assert.equal(image?.media?.mimetype, "image/png");
  assert.equal(parseInbound(upsert({ message: { documentMessage: {} } }))?.kind, "other");
});

test("parseInbound ignora o que não é mensagem de uma pessoa para nós", () => {
  assert.equal(parseInbound(upsert({}, { fromMe: true })), null);
  assert.equal(parseInbound(upsert({}, { remoteJid: "12345-678@g.us" })), null);
  assert.equal(parseInbound(upsert({}, { remoteJid: "status@broadcast" })), null);
  assert.equal(parseInbound(upsert({}, { id: "" })), null);
  assert.equal(parseInbound({ event: "connection.update", data: {} }), null);
  assert.equal(parseInbound(null), null);
  assert.equal(parseInbound("texto"), null);
});

test("parseInbound acha o telefone quando o remetente vem como @lid", () => {
  const m = parseInbound(upsert({}, { remoteJid: "123456789@lid", senderPn: "5584988887777:3@s.whatsapp.net" }));
  assert.equal(m?.phone, "+5584988887777");
  assert.equal(parseInbound(upsert({}, { remoteJid: "123456789@lid" })), null);
});

test("webhook exige a senha, no endereço ou no cabeçalho", async () => {
  const { d, log } = deps();
  assert.equal((await handleRequest(post(upsert(), "/webhook/errada"), d)).status, 401);
  assert.equal((await handleRequest(post(upsert(), "/webhook"), d)).status, 401);
  assert.equal(log.inbound.length, 0);
  assert.equal((await handleRequest(post(upsert(), "/webhook", { "x-webhook-secret": SECRET }), d)).status, 200);
  assert.equal(log.inbound.length, 1);
});

test("webhook sem senha configurada (ou curta) recusa tudo", async () => {
  const { d } = deps();
  assert.equal((await handleRequest(post(upsert(), "/webhook/"), { ...d, webhookSecret: "" })).status, 401);
  assert.equal((await handleRequest(post(upsert(), "/webhook/abc"), { ...d, webhookSecret: "abc" })).status, 401);
});

test("outros caminhos e métodos não existem", async () => {
  const { d } = deps();
  assert.equal((await handleRequest(new Request("https://zap.exemplo/x"), d)).status, 404);
  assert.equal((await handleRequest(new Request(`https://zap.exemplo/webhook/${SECRET}`), d)).status, 404);
  assert.equal(await (await handleRequest(new Request("https://zap.exemplo/"), d)).text(), "ok");
  assert.match(await (await handleRequest(new Request("https://zap.exemplo/robots.txt"), d)).text(), /Disallow: \//);
});

test("pessoa cadastrada recebe a confirmação pelo primeiro nome, e a resposta fica registrada", async () => {
  const { d, log } = deps({ usuario: { id: "u1", nome: "Maria Clara Silva" } });
  const res = await handleRequest(post(upsert()), d);
  assert.equal(res.status, 200);
  assert.equal(log.sent.length, 1);
  assert.equal(log.sent[0]![0], "+558499998888");
  assert.match(log.sent[0]![1], /^Olá, Maria! Recebi a sua mensagem\./);
  assert.match(log.sent[0]![1], /gestao\.exemplo\.com/);
  assert.deepEqual(log.out[0], ["+558499998888", "u1", log.sent[0]![1], null]);
  // As duas formas do número (com e sem o nono dígito) vão para a busca.
  assert.deepEqual((log.inbound[0] as { phones: string[] }).phones, ["+558499998888", "+5584999998888"]);
});

test("número não cadastrado: orienta até 3 vezes e depois fica em silêncio", async () => {
  for (const n of [0, 1, 2]) {
    const a = deps({ usuario: null, respostas_sem_cadastro: n });
    await handleRequest(post(upsert()), a.d);
    assert.match(a.log.sent[0]![1], /não está cadastrado/);
    assert.match(a.log.sent[0]![1], /gestor do serviço/);
  }
  const b = deps({ usuario: null, respostas_sem_cadastro: 3 });
  await handleRequest(post(upsert()), b.d);
  assert.equal(b.log.sent.length, 0);
});

test("fica em silêncio para repetida, enxurrada e resposta recente", () => {
  const msg = parseInbound(upsert())!;
  const base: InboundResult = { duplicada: false, usuario: { id: "u", nome: "Ana" }, recentes: 1, minutos_desde_resposta: null };
  assert.equal(replyFor(msg, { ...base, duplicada: true }, "https://x"), null);
  assert.equal(replyFor(msg, { ...base, recentes: 31 }, "https://x"), null);
  assert.equal(replyFor(msg, { ...base, minutos_desde_resposta: 3 }, "https://x"), null);
  assert.match(replyFor(msg, { ...base, minutos_desde_resposta: 11 }, "https://x")!, /Olá, Ana!/);
  assert.match(replyFor({ ...msg, kind: "audio" }, base, "https://x")!, /Recebi o seu áudio/);
});

test("eventos que não interessam respondem 200 sem tocar no banco", async () => {
  const { d, log } = deps();
  const res = await handleRequest(post({ event: "connection.update", data: {} }), d);
  assert.equal(res.status, 200);
  assert.equal(log.inbound.length, 0);
  assert.equal((await handleRequest(post("{não é json"), d)).status, 400);
});

test("banco fora do ar devolve 503 e não envia nada", async () => {
  const { d, log } = deps(null);
  assert.equal((await handleRequest(post(upsert()), d)).status, 503);
  assert.equal(log.sent.length, 0);
});

test("falha no envio fica registrada", async () => {
  const { d, log } = deps({ usuario: { id: "u1", nome: "Ana" } }, "HTTP 500");
  await handleRequest(post(upsert()), d);
  assert.equal((log.out[0] as unknown[])[3], "HTTP 500");
});

test("sendText chama a Evolution com a instância codificada e só os dígitos", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
  const err = await sendText({ url: "https://zap.exemplo/", instance: "Eccoprime Zap", apiKey: "k" }, "+558499998888", "oi", fake);
  assert.equal(err, null);
  assert.equal(seen!.url, "https://zap.exemplo/message/sendText/Eccoprime%20Zap");
  assert.deepEqual(JSON.parse(seen!.init.body as string), { number: "558499998888", text: "oi" });
  assert.equal((seen!.init.headers as Record<string, string>)["CF-Access-Client-Id"], undefined);
  await sendText(
    { url: "https://z", instance: "i", apiKey: "k", accessClientId: "id.access", accessClientSecret: "seg" },
    "+558499998888",
    "oi",
    fake,
  );
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h["CF-Access-Client-Id"], "id.access");
  assert.equal(h["CF-Access-Client-Secret"], "seg");
  const bad = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
  assert.equal(await sendText({ url: "https://z", instance: "i", apiKey: "k" }, "+5584", "oi", bad), "HTTP 401 (sem corpo; nenhum cabeçalho) [log v3]");
});

test("sendText: recusa sem corpo diz quem respondeu, pelos cabeçalhos", async () => {
  const bad = (async () =>
    new Response(null, { status: 400, headers: { server: "cloudflare" } })) as unknown as typeof fetch;
  assert.equal(
    await sendText({ url: "https://z", instance: "i", apiKey: "k" }, "+5584", "oi", bad),
    "HTTP 400 (sem corpo; server=cloudflare) [log v3]",
  );
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", "abc"), false);
});

test("parseInbound acha o telefone nos campos novos do formato @lid", () => {
  assert.equal(parseInbound(upsert({}, { remoteJid: "1@lid", participantAlt: "558499998888@s.whatsapp.net" }))?.phone, "+558499998888");
  assert.equal(parseInbound(upsert({ senderPn: "558499998888@s.whatsapp.net" }, { remoteJid: "1@lid" }))?.phone, "+558499998888");
});

test("describeIgnored resume o aviso sem números de telefone", () => {
  const d = describeIgnored(upsert({}, { remoteJid: "123456789@lid", senderLid: "987@lid" }))!;
  assert.equal(JSON.stringify(d).match(/\d{5,}/), null);
  assert.deepEqual((d.chave as Record<string, unknown>).remoteJid, "…@lid");
  assert.equal(describeIgnored({ event: "connection.update", data: {} }), null);
});

test("resposta: envio recusado pelo número tenta o endereço @lid da conversa", async () => {
  const sent: string[] = [];
  const d = deps({ usuario: { id: "u1", nome: "Ana" } });
  d.d.send = async (to) => (sent.push(to), to.startsWith("+") ? "HTTP 400: exists false" : null);
  await handleRequest(post(upsert({}, { remoteJid: "123@lid", senderPn: "558499998888@s.whatsapp.net" })), d.d);
  assert.deepEqual(sent, ["+558499998888", "123@lid"]);
});

test("sendText: endereço completo vai como está; erro traz o motivo com números mascarados", async () => {
  let body = "";
  const ok = (async (_u: string, init: RequestInit) => ((body = String(init.body)), new Response("{}"))) as unknown as typeof fetch;
  await sendText({ url: "https://z", instance: "i", apiKey: "k" }, "123@lid", "oi", ok);
  assert.equal(JSON.parse(body).number, "123@lid");
  const bad = (async () => new Response('{"exists":false,"number":"558499998888"}', { status: 400 })) as unknown as typeof fetch;
  const err = await sendText({ url: "https://z", instance: "i", apiKey: "k" }, "+558499998888", "oi", bad);
  assert.match(err!, /^HTTP 400: /);
  assert.equal(/\d{6,}/.test(err!), false);
});
