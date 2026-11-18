/**
 * Worker `ecco-whatsapp`: liga o atendimento (handler.ts) à Evolution API e ao
 * banco da Ecco. As funções `whatsapp_*` (migration 0049) só aceitam a chave de
 * servidor, guardada como segredo do Cloudflare.
 */

import { sendText } from "./evolution.ts";
import { handleRequest, type InboundResult } from "./handler.ts";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  EVOLUTION_URL: string;
  EVOLUTION_INSTANCE: string;
  EVOLUTION_API_KEY: string;
  WEBHOOK_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  APP_URL: string;
}

async function rpc(env: Env, fn: string, args: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(fn, "HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(fn, e instanceof Error ? e.name : "erro");
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      webhookSecret: env.WEBHOOK_SECRET ?? "",
      appUrl: env.APP_URL,
      async recordInbound(msg, phones) {
        return (await rpc(env, "whatsapp_inbound", {
          p_phone: msg.phone,
          p_phones: phones,
          p_provider_id: msg.providerId,
          p_kind: msg.kind,
          p_body: msg.text,
        })) as InboundResult | null;
      },
      async recordOutbound(phone, userId, body, error) {
        await rpc(env, "whatsapp_outbound", { p_phone: phone, p_user: userId, p_body: body, p_error: error });
      },
      send: (phone, text) =>
        sendText(
          {
            url: env.EVOLUTION_URL,
            instance: env.EVOLUTION_INSTANCE,
            apiKey: env.EVOLUTION_API_KEY,
            accessClientId: env.CF_ACCESS_CLIENT_ID,
            accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
          },
          phone,
          text,
        ),
    });
  },
};
