/**
 * Worker `ecco-mcp`: liga o servidor MCP (server.ts) ao banco da Ecco.
 *
 * Só usa a chave PÚBLICA do Supabase. A função `mcp_call` (migration 0039)
 * confere o token pessoal pelo hash, aplica o limite de chamadas, restringe ao
 * alcance do dono do token e registra a consulta. O Worker é só um tradutor.
 */

import { handleRequest, type ReportOutcome } from "./server.ts";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      async callReport(tokenHash, tool, args): Promise<ReportOutcome> {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mcp_call`, {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_token_hash: tokenHash, p_tool: tool, p_args: args }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          console.error("mcp_call HTTP", res.status, (await res.text()).slice(0, 300));
          return {
            error: { code: "unavailable", message: "O sistema não respondeu. Tente de novo em instantes." },
          };
        }
        return (await res.json()) as ReportOutcome;
      },
    });
  },
};
