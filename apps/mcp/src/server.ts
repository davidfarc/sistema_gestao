/**
 * Servidor MCP, transporte Streamable HTTP, sem estado e sem dependências.
 *
 * Cada requisição é um POST com uma mensagem JSON-RPC; a resposta é um JSON
 * simples (o protocolo permite, e dispensa manter conexões abertas). Não há
 * sessão: o token pessoal vai em toda chamada.
 *
 * Este arquivo não conhece Cloudflare nem Supabase: recebe o que precisa por
 * `deps`, para poder ser testado sem rede.
 */

import { INSTRUCTIONS, TOOL_NAMES, TOOLS } from "./tools.ts";

export const SERVER_INFO = { name: "ecco-mcp", title: "Ecco Prime — Gestão", version: "0.1.0" };

/** Versões do protocolo que este servidor fala (a mais nova primeiro). */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export type ReportOutcome =
  | { result: unknown }
  | { error: { code: string; message: string } };

export interface Deps {
  /** Executa uma ferramenta no banco, em nome do dono do token. */
  callReport(tokenHash: string, tool: string, args: Record<string, unknown>): Promise<ReportOutcome>;
}

interface RpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Token da requisição: cabeçalho `Authorization: Bearer ecco_…` (preferido) ou,
 * para assistentes que não deixam configurar cabeçalho, no caminho
 * `/mcp/ecco_…`. Devolve null se não houver ou não tiver o formato esperado.
 */
export function extractToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const fromPath = /^\/mcp\/([^/]+)\/?$/.exec(new URL(request.url).pathname)?.[1];
  const token = bearer ?? fromPath ?? null;
  return token && /^ecco_[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

async function handleMessage(msg: RpcRequest, token: string, deps: Deps): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? null : rpcError(msg.id, -32600, "Requisição JSON-RPC inválida.");
  }
  // Notificações (ex.: notifications/initialized) não têm resposta.
  if (isNotification) return null;

  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const wanted = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: TOOLS.map((t) => ({
          ...t,
          // Dica para o assistente: nenhuma ferramenta altera dados.
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!TOOL_NAMES.has(name)) return rpcError(msg.id, -32602, `Ferramenta desconhecida: ${name}`);
      const args =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      let outcome: ReportOutcome;
      try {
        outcome = await deps.callReport(await sha256Hex(token), name, args);
      } catch {
        outcome = { error: { code: "unavailable", message: "O sistema não respondeu. Tente de novo em instantes." } };
      }
      // Erro de uso (token, permissão, argumento) volta como resultado com
      // isError: assim o assistente lê a mensagem e pode se corrigir.
      if ("error" in outcome) {
        return ok({ content: [{ type: "text", text: outcome.error.message }], isError: true });
      }
      return ok({ content: [{ type: "text", text: JSON.stringify(outcome.result, null, 2) }] });
    }
    default:
      return rpcError(msg.id, -32601, `Método não suportado: ${msg.method}`);
  }
}

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/health") {
    return json({ ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version });
  }
  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) {
    return json({ error: "not_found" }, 404);
  }
  // Sem fluxo aberto pelo servidor nem sessão para encerrar: só POST.
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }

  const token = extractToken(request);
  if (!token) {
    return json(
      rpcError(null, -32001, "Token ausente ou inválido. Gere um em Configurações → Integrações."),
      401,
      { "WWW-Authenticate": 'Bearer realm="ecco-mcp"' },
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 100_000) return json(rpcError(null, -32600, "Requisição grande demais."), 413);
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "JSON inválido."), 400);
  }

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) {
      return json(rpcError(null, -32600, "Lote vazio ou grande demais."), 400);
    }
    const replies: unknown[] = [];
    for (const item of body) {
      const reply = await handleMessage(item as RpcRequest, token, deps);
      if (reply) replies.push(reply);
    }
    return replies.length > 0 ? json(replies) : new Response(null, { status: 202 });
  }

  const reply = await handleMessage((body ?? {}) as RpcRequest, token, deps);
  return reply ? json(reply) : new Response(null, { status: 202 });
}
