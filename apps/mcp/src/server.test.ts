import assert from "node:assert/strict";
import { test } from "node:test";

import { extractToken, handleRequest, sha256Hex, type Deps } from "./server.ts";
import { TOOLS } from "./tools.ts";

const TOKEN = "ecco_" + "a".repeat(43);

function deps(result: unknown = { ok: 1 }) {
  const calls: { hash: string; tool: string; args: unknown }[] = [];
  const d: Deps = {
    async callReport(hash, tool, args) {
      calls.push({ hash, tool, args });
      return result as never;
    },
  };
  return { d, calls };
}

function post(body: unknown, opts: { token?: string | null; path?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
  return new Request(`https://mcp.example${opts.path ?? "/mcp"}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const rpc = (method: string, params?: unknown, id: number | undefined = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize negocia a versão e anuncia só ferramentas", async () => {
  const { d } = deps();
  const res = await handleRequest(post(rpc("initialize", { protocolVersion: "2025-03-26" })), d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.result.protocolVersion, "2025-03-26");
  assert.deepEqual(Object.keys(body.result.capabilities), ["tools"]);
  assert.equal(body.result.serverInfo.name, "ecco-mcp");

  const other = (await (await handleRequest(post(rpc("initialize", { protocolVersion: "1999-01-01" })), d)).json()) as any;
  assert.equal(other.result.protocolVersion, "2025-06-18");
});

test("notificação não tem resposta (202)", async () => {
  const { d } = deps();
  const res = await handleRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }), d);
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("tools/list traz as 7 ferramentas, todas marcadas como somente leitura", async () => {
  const { d } = deps();
  const body = (await (await handleRequest(post(rpc("tools/list")), d)).json()) as any;
  assert.equal(body.result.tools.length, 7);
  assert.deepEqual(
    body.result.tools.map((t: any) => t.name).sort(),
    TOOLS.map((t) => t.name).sort(),
  );
  for (const t of body.result.tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.inputSchema.type, "object");
  }
});

test("tools/call envia o HASH do token (nunca o token) e devolve o resultado em texto", async () => {
  const { d, calls } = deps({ result: [{ nome: "Editorial" }] });
  const res = await handleRequest(post(rpc("tools/call", { name: "listar_pipelines", arguments: {} })), d);
  const body = (await res.json()) as any;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.hash, await sha256Hex(TOKEN));
  assert.notEqual(calls[0]!.hash, TOKEN);
  assert.equal(calls[0]!.tool, "listar_pipelines");
  assert.equal(body.result.isError, undefined);
  assert.deepEqual(JSON.parse(body.result.content[0].text), [{ nome: "Editorial" }]);
});

test("erro do banco (token revogado, sem permissão…) vira isError com a mensagem", async () => {
  const { d } = deps({ error: { code: "invalid_token", message: "Token inválido, revogado ou vencido." } });
  const body = (await (await handleRequest(post(rpc("tools/call", { name: "atividades", arguments: { dias: 7 } })), d)).json()) as any;
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /revogado/);
});

test("ferramenta desconhecida não chega ao banco", async () => {
  const { d, calls } = deps();
  const body = (await (await handleRequest(post(rpc("tools/call", { name: "apagar_tudo" })), d)).json()) as any;
  assert.equal(body.error.code, -32602);
  assert.equal(calls.length, 0);
});

test("falha de rede no banco não derruba o servidor", async () => {
  const d: Deps = { callReport: async () => { throw new Error("rede"); } };
  const body = (await (await handleRequest(post(rpc("tools/call", { name: "listar_pipelines" })), d)).json()) as any;
  assert.equal(body.result.isError, true);
});

test("sem token ou com token fora do formato: 401", async () => {
  const { d, calls } = deps();
  for (const token of [null, "qualquer-coisa", "ecco_curto"]) {
    const res = await handleRequest(post(rpc("tools/list"), { token }), d);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("WWW-Authenticate") ?? "", /Bearer/);
  }
  assert.equal(calls.length, 0);
});

test("token no caminho /mcp/<token> também vale", async () => {
  const { d } = deps();
  const res = await handleRequest(post(rpc("ping"), { token: null, path: `/mcp/${TOKEN}` }), d);
  assert.equal(res.status, 200);
  assert.equal(extractToken(post({}, { token: null, path: "/mcp/errado" })), null);
});

test("só POST; outros caminhos 404; JSON inválido 400; método desconhecido -32601", async () => {
  const { d } = deps();
  const get = await handleRequest(new Request("https://mcp.example/mcp", { headers: { Authorization: `Bearer ${TOKEN}` } }), d);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  assert.equal((await handleRequest(new Request("https://mcp.example/outra"), d)).status, 404);
  assert.equal((await handleRequest(post("{nao é json"), d)).status, 400);
  const unknown = (await (await handleRequest(post(rpc("resources/list")), d)).json()) as any;
  assert.equal(unknown.error.code, -32601);
  assert.equal((await handleRequest(new Request("https://mcp.example/health"), d)).status, 200);
});

test("lote: responde só às requisições, na ordem", async () => {
  const { d } = deps();
  const res = await handleRequest(
    post([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, 2)]),
    d,
  );
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((r) => r.id), [1, 2]);
});
