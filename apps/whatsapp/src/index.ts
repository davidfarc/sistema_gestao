/**
 * Worker `ecco-whatsapp`: liga o atendimento (handler.ts) à Evolution API e ao
 * banco da Ecco. As funções `whatsapp_*` (migration 0049) só aceitam a chave de
 * servidor, guardada como segredo do Cloudflare.
 */

import { callOpenAI, runAgent, transcribeOpenAI } from "./agent.ts";
import { fetchMedia, sendText, type EvolutionConfig } from "./evolution.ts";
import { deliverOutbox, handleRequest, type InboundResult, type OutboxItem } from "./handler.ts";

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
  /** Chave da API da OpenAI. Sem ela o atendimento só confirma o recebimento. */
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  OPENAI_TRANSCRIBE_MODEL: string;
  /** O site (Worker ecco-sistema), para executar a liberação pelas regras dele. */
  SITE?: { fetch(request: Request): Promise<Response> };
  /** Segredo igual nos dois Workers; prova ao site que a chamada é nossa. */
  WHATSAPP_SERVICE_SECRET?: string;
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

function evolutionConfig(env: Env): EvolutionConfig {
  return {
    url: env.EVOLUTION_URL,
    instance: env.EVOLUTION_INSTANCE,
    apiKey: env.EVOLUTION_API_KEY,
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  };
}

/** Pede ao site para liberar o card como a pessoa. Null se o site não respondeu. */
async function releaseOnSite(
  env: Env,
  userId: string,
  cardId: string,
  assigneeId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!env.SITE || !env.WHATSAPP_SERVICE_SECRET) return { erro: "A liberação por mensagem não está configurada. Libere pelo site." };
  try {
    const res = await env.SITE.fetch(
      new Request(`${env.APP_URL.replace(/\/+$/, "")}/api/whatsapp/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-secret": env.WHATSAPP_SERVICE_SECRET },
        body: JSON.stringify({ acao: "liberar", userId, cardId, assigneeId }),
        signal: AbortSignal.timeout(20_000),
      }),
    );
    if (!res.ok) {
      console.error("site liberar HTTP", res.status);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("site liberar", e instanceof Error ? e.name : "erro");
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const openaiKey = env.OPENAI_API_KEY;
    const evolution = evolutionConfig(env);
    return handleRequest(request, {
      defer: (work) => ctx.waitUntil(work),
      transcribe: openaiKey
        ? async (msg) => {
            const media = msg.media ? await fetchMedia(evolution, msg.media) : null;
            if (!media) return false;
            const heard = await transcribeOpenAI(openaiKey, env.OPENAI_TRANSCRIBE_MODEL, media);
            if (!heard) return false;
            const saved = await rpc(env, "whatsapp_set_transcript", {
              p_provider_id: msg.providerId,
              p_body: `[áudio] ${heard}`,
            });
            if (saved !== true) console.error("transcrição não gravada (migration 0051 aplicada?)");
            return saved === true;
          }
        : undefined,
      agent: openaiKey
        ? (userId) =>
            runAgent({
              appUrl: env.APP_URL,
              db: async (tool, args) =>
                (await rpc(env, "whatsapp_agent", { p_user: userId, p_tool: tool, p_args: args })) as Record<
                  string,
                  unknown
                > | null,
              modelName: env.OPENAI_MODEL,
              release: (cardId, assigneeId) => releaseOnSite(env, userId, cardId, assigneeId),
              model: (request) => callOpenAI(openaiKey, request),
            })
        : undefined,
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
      send: (phone, text) => sendText(evolution, phone, text),
    });
  },

  /** A cada minuto: lembretes na hora e avisos pendentes (migration 0052). */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const evolution = evolutionConfig(env);
    await deliverOutbox({
      enqueueReminders: async () => void (await rpc(env, "whatsapp_enqueue_reminders", {})),
      take: async () => (await rpc(env, "whatsapp_outbox_take", { p_limit: 20 })) as OutboxItem[] | null,
      done: async (id, error) => void (await rpc(env, "whatsapp_outbox_done", { p_id: id, p_error: error })),
      send: (phone, text) => sendText(evolution, phone, text),
    });
  },
};
