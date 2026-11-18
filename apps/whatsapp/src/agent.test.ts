import assert from "node:assert/strict";
import { test } from "node:test";

import { callOpenAI, runAgent, transcribeOpenAI, unbackedClaim, systemPrompt, toMessages, TOOLS, type AgentContext, type AgentDeps } from "./agent.ts";
import { fetchMedia } from "./evolution.ts";
import { deliverOutbox, handleRequest, type Deps } from "./handler.ts";

const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({
  pessoa: "Ana Lima",
  hoje: "18/11/2026 10:00",
  pipelines: [{ id: "p1", nome: "Manutenção", instrucoes: "Salas 1 a 20.", campos: [{ nome: "Sala", obrigatorio: true }] }],
  conversa: [{ de: "pessoa", texto: "O ar da sala 12 não liga" }],
  ...over,
});

const say = (t: string | null, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content: t } }] });
const call = (name: string, input: unknown, id = "t1") => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: typeof input === "string" ? input : JSON.stringify(input) } }] },
    },
  ],
});

function deps(replies: unknown[], context: AgentContext | null = ctx(), dbOut: Record<string, unknown> | null = { ok: true, numero: 142 }) {
  const log = { db: [] as [string, unknown][], model: [] as any[] };
  const d: AgentDeps = {
    appUrl: "https://gestao.exemplo.com",
    modelName: "modelo-x",
    async db(tool, args) {
      log.db.push([tool, args]);
      return tool === "contexto" ? (context as never) : dbOut;
    },
    async model(request) {
      // Cópia: o agente continua acrescentando ao mesmo array depois.
      log.model.push(JSON.parse(JSON.stringify(request)));
      return replies.shift() as never;
    },
  };
  return { d, log };
}

test("resposta direta: uma chamada ao modelo, com o contexto no prompt", async () => {
  const { d, log } = deps([say("Qual é o número da sala?")]);
  assert.equal(await runAgent(d), "Qual é o número da sala?");
  const p = log.model[0];
  assert.deepEqual(Object.keys(p).sort(), ["messages", "model", "tools"]);
  assert.equal(p.model, "modelo-x");
  assert.equal(p.messages[0].role, "system");
  assert.match(p.messages[0].content, /Ana Lima/);
  assert.match(p.messages[0].content, /Manutenção/);
  assert.deepEqual(p.messages[1], { role: "user", content: "O ar da sala 12 não liga" });
});

test("busca, cria e confirma: os campos viram objeto e os resultados voltam ao modelo", async () => {
  const { d, log } = deps([
    call("buscar_pedidos", { pipeline_id: "p1", texto: "12" }),
    call("criar_pedido", { pipeline_id: "p1", titulo: "Ar não liga - sala 12", descricao: "não liga", campos: [{ nome: "Sala", valor: "12" }] }, "t2"),
    say("Pedido #142 aberto."),
  ]);
  assert.equal(await runAgent(d), "Pedido #142 aberto.");
  assert.deepEqual(log.db.map((c) => c[0]), ["contexto", "buscar_pedidos", "criar_pedido"]);
  assert.deepEqual((log.db[2]![1] as any).campos, { Sala: "12" });
  const last = log.model[2].messages;
  assert.deepEqual(last.map((m: any) => m.role), ["system", "user", "assistant", "tool", "assistant", "tool"]);
  assert.equal(last[2].tool_calls[0].id, "t1");
  assert.equal(last[3].tool_call_id, "t1");
  assert.deepEqual(JSON.parse(last[5].content), { ok: true, numero: 142 });
});

test("erro da ferramenta volta ao modelo, para ele corrigir", async () => {
  const { d, log } = deps([call("criar_pedido", { pipeline_id: "p1", titulo: "x", descricao: "", campos: [] }), say("Qual a sala?")], ctx(), {
    erro: "Faltam campos obrigatórios: Sala.",
  });
  assert.equal(await runAgent(d), "Qual a sala?");
  assert.match(log.model[1].messages[3].content, /Faltam campos/);
});

test("ferramenta desconhecida e argumentos quebrados não chegam ao banco", async () => {
  const a = deps([call("apagar_tudo", {}), say("Não posso fazer isso.")]);
  await runAgent(a.d);
  assert.deepEqual(a.log.db.map((c) => c[0]), ["contexto"]);
  assert.match(a.log.model[1].messages[3].content, /desconhecida/);
  const b = deps([call("buscar_pedidos", "{quebrado"), say("ok")]);
  await runAgent(b.d);
  assert.deepEqual(b.log.db.map((c) => c[0]), ["contexto"]);
  assert.match(b.log.model[1].messages[3].content, /inválidos/);
});

test("devolve null em recusa, corte, laço sem fim, API e banco fora", async () => {
  assert.equal(await runAgent(deps([{ choices: [{ finish_reason: "stop", message: { content: "x", refusal: "não" } }] }]).d), null);
  assert.equal(await runAgent(deps([say("meio", "length")]).d), null);
  assert.equal(await runAgent(deps([say("x", "content_filter")]).d), null);
  assert.equal(await runAgent(deps(Array.from({ length: 10 }, () => call("situacao_pedido", { numero: "1" }))).d), null);
  assert.equal(await runAgent(deps([null]).d), null);
  assert.equal(await runAgent(deps([{}]).d), null);
  assert.equal(await runAgent(deps([say("x")], null).d), null);
  assert.equal(await runAgent(deps([say("  ")]).d), null);
});

test("histórico: começa na pessoa e precisa terminar nela", async () => {
  assert.deepEqual(
    toMessages([
      { de: "agente", texto: "Recebi" },
      { de: "pessoa", texto: "oi" },
      { de: "agente", texto: "Olá" },
      { de: "pessoa", texto: "sala 3" },
    ]).map((m) => m.role),
    ["user", "assistant", "user"],
  );
  const { d, log } = deps([say("x")], ctx({ conversa: [{ de: "pessoa", texto: "oi" }, { de: "agente", texto: "Olá" }] }));
  assert.equal(await runAgent(d), null);
  assert.equal(log.model.length, 0);
});

test("ferramentas: esquema fechado, e nenhuma que mova, apague ou configure", () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name).sort(), ["buscar_pedidos", "comentar_pedido", "criar_pedido", "liberar_pedido", "reforcar_pedido", "situacao_pedido"]);
  for (const t of TOOLS) {
    const p = t.function.parameters as any;
    assert.equal(t.type, "function");
    assert.equal(t.function.strict, true);
    assert.equal(p.additionalProperties, false);
    assert.deepEqual([...p.required].sort(), Object.keys(p.properties).sort());
  }
  assert.match(systemPrompt(ctx({ pipelines: [] }), "https://x"), /nenhum pipeline disponível/);
});

test("callOpenAI: endereço, chave no cabeçalho e null em falha", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(say("oi")), { status: 200 });
  }) as unknown as typeof fetch;
  const req = { model: "m", messages: [], tools: [] };
  assert.deepEqual(await callOpenAI("sk-teste", req, ok), say("oi"));
  assert.equal(seen!.url, "https://api.openai.com/v1/chat/completions");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer sk-teste");
  assert.deepEqual(JSON.parse(seen!.init.body as string), req);
  const bad = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await callOpenAI("k", req, bad), null);
  const boom = (async () => Promise.reject(new Error("rede"))) as unknown as typeof fetch;
  assert.equal(await callOpenAI("k", req, boom), null);
});

// ── integração com o webhook ────────────────────────────────────────────────

const SECRET = "s".repeat(40);
const hook = (message: unknown) =>
  new Request(`https://zap.exemplo/webhook/${SECRET}`, {
    method: "POST",
    body: JSON.stringify({ event: "messages.upsert", data: { key: { remoteJid: "558499998888@s.whatsapp.net", id: "A1" }, message } }),
  });

function hdeps(over: Partial<Deps> = {}, usuario: { id: string; nome: string } | null = { id: "u1", nome: "Ana" }) {
  const sent: string[] = [];
  const pending: Promise<void>[] = [];
  const d: Deps = {
    webhookSecret: SECRET,
    appUrl: "https://gestao.exemplo.com",
    recordInbound: async () => ({ duplicada: false, usuario, recentes: 1, minutos_desde_resposta: 1 }),
    recordOutbound: async () => {},
    send: async (_p, t) => (sent.push(t), null),
    agent: async () => "Pedido #7 aberto.",
    defer: (w) => void pending.push(w),
    ...over,
  };
  return { d, sent, pending };
}

test("webhook responde na hora e o agente envia depois", async () => {
  const { d, sent, pending } = hdeps();
  assert.equal((await handleRequest(hook({ conversation: "sala 3 sem luz" }), d)).status, 200);
  await Promise.all(pending);
  assert.deepEqual(sent, ["Pedido #7 aberto."]);
});

test("áudio pede texto; agente que falha manda a contingência; desconhecido não chega ao agente", async () => {
  let ran = 0;
  const a = hdeps({ agent: async () => (ran++, "x") });
  await handleRequest(hook({ audioMessage: {} }), a.d);
  await Promise.all(a.pending);
  assert.match(a.sent[0]!, /não consigo ouvir áudio/);
  assert.equal(ran, 0);
  const img = hdeps({ agent: async () => (ran++, "x") });
  await handleRequest(hook({ imageMessage: {} }), img.d);
  await Promise.all(img.pending);
  assert.match(img.sent[0]!, /só entendo texto e áudio/);
  assert.equal(ran, 0);

  for (const agent of [async () => null, async () => Promise.reject(new Error("x"))]) {
    const b = hdeps({ agent });
    await handleRequest(hook({ conversation: "oi" }), b.d);
    await Promise.all(b.pending);
    assert.match(b.sent[0]!, /Tive um problema/);
  }

  const c = hdeps({ agent: async () => (ran++, "x"), recordInbound: async () => ({ duplicada: false, usuario: null, recentes: 1, minutos_desde_resposta: null }) });
  await handleRequest(hook({ conversation: "oi" }), c.d);
  await Promise.all(c.pending);
  assert.match(c.sent[0]!, /não está cadastrado/);
  assert.equal(ran, 0);
});

test("repetida e enxurrada não chamam o agente", async () => {
  let ran = 0;
  for (const r of [{ duplicada: true, recentes: 1 }, { duplicada: false, recentes: 99 }]) {
    const x = hdeps({ agent: async () => (ran++, "x"), recordInbound: async () => ({ usuario: { id: "u", nome: "A" }, minutos_desde_resposta: null, ...r }) });
    await handleRequest(hook({ conversation: "oi" }), x.d);
    await Promise.all(x.pending);
    assert.equal(x.sent.length, 0);
  }
  assert.equal(ran, 0);
});

test("áudio: transcreve e segue para o agente; falha ou áudio longo pedem outro", async () => {
  let ran = 0;
  const heard: string[] = [];
  const ok = hdeps({ agent: async () => (ran++, "Pedido #9 aberto."), transcribe: async (m) => (heard.push(m.providerId), true) });
  await handleRequest(hook({ audioMessage: { seconds: 12 } }), ok.d);
  await Promise.all(ok.pending);
  assert.deepEqual(heard, ["A1"]);
  assert.deepEqual(ok.sent, ["Pedido #9 aberto."]);

  for (const transcribe of [async () => false, async () => Promise.reject(new Error("x"))]) {
    const bad = hdeps({ agent: async () => (ran++, "x"), transcribe });
    await handleRequest(hook({ audioMessage: { seconds: 5 } }), bad.d);
    await Promise.all(bad.pending);
    assert.match(bad.sent[0]!, /Não consegui entender o áudio/);
  }
  const long = hdeps({ agent: async () => (ran++, "x"), transcribe: async () => (heard.push("longo"), true) });
  await handleRequest(hook({ audioMessage: { seconds: 400 } }), long.d);
  await Promise.all(long.pending);
  assert.match(long.sent[0]!, /longo demais/);
  assert.equal(ran, 1);
  assert.equal(heard.includes("longo"), false);
});

test("fetchMedia: manda a mensagem inteira à Evolution e decodifica; usa o base64 do webhook se veio", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const cfg = { url: "https://zap.exemplo", instance: "Eccoprime Zap", apiKey: "k", accessClientId: "id", accessClientSecret: "seg" };
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ base64: btoa("OggS"), mimetype: "audio/ogg; codecs=opus" }));
  }) as unknown as typeof fetch;
  const ref = { key: { id: "A1", remoteJid: "x" }, message: { audioMessage: { mediaKey: "mk" } } };
  const media = await fetchMedia(cfg, ref, ok);
  assert.equal(seen!.url, "https://zap.exemplo/chat/getBase64FromMediaMessage/Eccoprime%20Zap");
  assert.deepEqual(JSON.parse(seen!.init.body as string), { message: ref, convertToMp4: false });
  assert.equal((seen!.init.headers as Record<string, string>)["CF-Access-Client-Id"], "id");
  assert.equal(new TextDecoder().decode(media!.bytes), "OggS");
  assert.equal(media!.mimetype, "audio/ogg");

  const never = (async () => Promise.reject(new Error("não devia chamar"))) as unknown as typeof fetch;
  const inline = await fetchMedia(cfg, { ...ref, base64: btoa("abc"), mimetype: "audio/mp4" }, never);
  assert.equal(new TextDecoder().decode(inline!.bytes), "abc");
  assert.equal(inline!.mimetype, "audio/mp4");

  const big = (async () => new Response(JSON.stringify({ base64: "A".repeat(6_000_000) }))) as unknown as typeof fetch;
  assert.equal(await fetchMedia(cfg, ref, big), null);
  const bad = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchMedia(cfg, ref, bad), null);
  const empty = (async () => new Response("{}")) as unknown as typeof fetch;
  assert.equal(await fetchMedia(cfg, ref, empty), null);
});

test("transcribeOpenAI: manda o arquivo em formulário e devolve o texto", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ text: "  o ar da sala doze não liga " }));
  }) as unknown as typeof fetch;
  const audio = { bytes: new TextEncoder().encode("OggS"), mimetype: "audio/ogg" };
  assert.equal(await transcribeOpenAI("sk-t", "modelo-voz", audio, ok), "o ar da sala doze não liga");
  assert.equal(seen!.url, "https://api.openai.com/v1/audio/transcriptions");
  const form = seen!.init.body as FormData;
  assert.equal(form.get("model"), "modelo-voz");
  assert.equal(form.get("language"), null);
  assert.match(String(form.get("prompt")), /português do Brasil/);
  assert.equal((form.get("file") as File).name, "audio.ogg");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer sk-t");
  const bad = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
  assert.equal(await transcribeOpenAI("k", "m", audio, bad), null);
  const empty = (async () => new Response(JSON.stringify({ text: " " }))) as unknown as typeof fetch;
  assert.equal(await transcribeOpenAI("k", "m", audio, empty), null);
});

test("prompt: menu só na dúvida e transcrição de áudio", () => {
  const p = systemPrompt(ctx(), "https://x");
  assert.match(p, /menu numerado/);
  assert.match(p, /siga direto/);
  assert.match(p, /\[áudio\]/);
});

test("liberar_pedido: o banco confere, o site executa; erro do banco não chega ao site", async () => {
  const released: any[] = [];
  const ok = deps([call("liberar_pedido", { pipeline_id: "p1", numero: "3", responsavel: "" }), say("Pedido #3 liberado para a Maria.")], ctx(), {
    ok: true,
    card_id: "c-1",
    numero: 3,
    assignee_id: "u-9",
  });
  ok.d.release = async (cardId, assigneeId) => (released.push([cardId, assigneeId]), { ok: true, etapa: "Em andamento", responsavel: "Maria" });
  assert.equal(await runAgent(ok.d), "Pedido #3 liberado para a Maria.");
  assert.deepEqual(ok.log.db.map((c) => c[0]), ["contexto", "preparar_liberacao"]);
  assert.deepEqual(released, [["c-1", "u-9"]]);
  assert.match(ok.log.model[1].messages[3].content, /Em andamento/);

  const many = deps([call("liberar_pedido", { pipeline_id: "p1", numero: "3", responsavel: "" }), say("Com quem fica?")], ctx(), {
    erro: "Há mais de uma pessoa",
    equipe: ["Ana", "Bia"],
  });
  let wrong = 0;
  many.d.release = async () => (wrong++, null);
  assert.equal(await runAgent(many.d), "Com quem fica?");
  assert.equal(wrong, 0);
  assert.match(many.log.model[1].messages[3].content, /Bia/);

  const off = deps([call("liberar_pedido", { pipeline_id: "p1", numero: "3", responsavel: "" }), say("Libere pelo site.")]);
  await runAgent(off.d);
  assert.deepEqual(off.log.db.map((c) => c[0]), ["contexto"]);
  assert.match(off.log.model[1].messages[3].content, /não está disponível/);
});

test("fila de avisos: envia, confirma e registra a falha", async () => {
  const done: [string, string | null][] = [];
  let reminders = 0;
  const sent = await deliverOutbox({
    enqueueReminders: async () => void reminders++,
    take: async () => [
      { id: "1", phone: "+5584911110001", body: "Novo pedido #3" },
      { id: "2", phone: "+5584911110002", body: "Lembrete" },
      { id: "3", phone: "+5584911110003", body: "" },
    ],
    done: async (id, error) => void done.push([id, error]),
    send: async (phone) => (phone.endsWith("2") ? "HTTP 500" : null),
  });
  assert.equal(sent, 1);
  assert.equal(reminders, 1);
  assert.deepEqual(done, [["1", null], ["2", "HTTP 500"]]);
  assert.equal(await deliverOutbox({ enqueueReminders: async () => Promise.reject(new Error("x")), take: async () => null, done: async () => {}, send: async () => null }), 0);
});

test("trava: confirmação sem ferramenta é cobrada uma vez e nunca chega à pessoa", async () => {
  // Inventou a abertura: é cobrado, chama a ferramenta e só então confirma.
  const a = deps([
    say("Pedido #142 aberto em Manutenção."),
    call("criar_pedido", { pipeline_id: "p1", titulo: "Ar", descricao: "", campos: [{ nome: "Sala", valor: "12" }] }),
    say("Pedido #142 aberto em Manutenção."),
  ]);
  assert.equal(await runAgent(a.d), "Pedido #142 aberto em Manutenção.");
  assert.deepEqual(a.log.db.map((c) => c[0]), ["contexto", "criar_pedido"]);
  assert.match(a.log.model[1].messages.at(-1).content, /aviso do sistema/);

  // Insistiu na invenção: contingência.
  assert.equal(await runAgent(deps([say("Pedido #7 aberto."), say("Pronto, pedido #7 criado!")]).d), null);
  // Chamou a busca e anunciou um número que nenhuma ferramenta devolveu.
  assert.equal(await runAgent(deps([call("buscar_pedidos", { pipeline_id: "p1", texto: "" }), say("Pedido #55 aberto."), say("Pedido #55 aberto.")], ctx(), { abertos: [{ numero: 9 }] }).d), null);
});

test("trava: o que é e o que não é confirmação inventada", () => {
  const none = new Set<string>();
  const no = new Set<number>();
  assert.equal(unbackedClaim("Qual é o número da sala?", none, no), null);
  assert.equal(unbackedClaim("Quer que eu abra o pedido?", none, no), null);
  assert.equal(unbackedClaim("O pedido ainda não foi aberto: falta a sala.", none, no), null);
  assert.equal(unbackedClaim("Não achei o pedido 142.", none, no), null);
  assert.match(unbackedClaim("Pronto! Abri o pedido para você.", none, no)!, /aberto/);
  assert.match(unbackedClaim("Sua demanda foi registrada com sucesso.", none, no)!, /aberto/);
  assert.match(unbackedClaim("Pedido #3 liberado para a Maria.", none, no)!, /liberado/);
  assert.notEqual(unbackedClaim("Registrei a atualização no card.", none, no), null);
  assert.match(unbackedClaim("A novidade foi registrada.", none, no)!, /atualização/);
  // Com a ferramenta certa e o número devolvido por ela, passa.
  assert.equal(unbackedClaim("Pedido #142 aberto em Manutenção.", new Set(["criar_pedido"]), new Set([142])), null);
  assert.equal(unbackedClaim("Já existe o pedido #9 aberto; registrei o seu reforço.", new Set(["buscar_pedidos", "reforcar_pedido"]), new Set([9])), null);
  assert.equal(unbackedClaim("O pedido #9 foi aberto em 12/11 e está em Triagem.", new Set(["situacao_pedido"]), new Set([9])), null);
  assert.equal(unbackedClaim("Pedido #3 liberado para a Maria.", new Set(["liberar_pedido"]), new Set([3])), null);
  // Número trocado em relação ao que a ferramenta devolveu.
  assert.match(unbackedClaim("Pedido #143 aberto.", new Set(["criar_pedido"]), new Set([142]))!, /aberto/);
});
