import { phoneVariants } from "../../../packages/core/src/phone.ts";

import { classify } from "./classify.ts";
import { parseVilaEvent } from "./parse.ts";
import { PROMPT_VERSION } from "./prompt.ts";

/**
 * Triagem das mensagens das famílias (SPEC-FASE2 §F). SÓ LÊ: recebe o webhook
 * da instância "Gestão Vila-2" e grava; a cada 5 minutos classifica e roda o
 * relógio das 4 horas úteis; às 7h30 dos dias úteis manda os resumos. Os avisos
 * entram na fila do Luix, que os entrega pelo número dele.
 */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WEBHOOK_SECRET: string;
  EVOLUTION_INSTANCE: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
}

export interface Deps {
  webhookSecret: string;
  instance: string;
  record(args: Record<string, unknown>): Promise<unknown>;
}

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/robots.txt") return text("User-agent: *\nDisallow: /\n");
  if (request.method === "GET" && url.pathname === "/") return text("ok");
  const m = /^\/webhook(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!m || request.method !== "POST") return text("não encontrado", 404);
  const given = m[1] ? decodeURIComponent(m[1]) : (request.headers.get("x-webhook-secret") ?? "");
  if (!deps.webhookSecret || deps.webhookSecret.length < 24 || !safeEqual(given, deps.webhookSecret)) {
    console.log(`webhook recusado: senha ${given ? `diferente (${given.length} caracteres)` : "ausente"}`);
    return text("não autorizado", 401);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return text("corpo inválido", 400);
  }
  // Só a instância da Gestão de Vila. O número do Luix nunca entra aqui.
  const from = (payload as { instance?: unknown } | null)?.instance;
  if (typeof from !== "string" || from.trim().toLowerCase() !== deps.instance.trim().toLowerCase()) {
    console.log("aviso de outra instância ignorado");
    return text("ignorado");
  }
  const ev = parseVilaEvent(payload);
  if (!ev) return text("ignorado");
  const saved = await deps.record({
    p_source: "whatsapp_vila",
    p_phone: ev.phone,
    p_phones: phoneVariants(ev.phone),
    p_provider_id: ev.providerId,
    p_from_family: ev.fromFamily,
    p_kind: ev.kind,
    p_body: ev.text,
    p_at: ev.at,
  });
  if (!saved) return text("indisponível", 503);
  console.log(`entrada: ${ev.fromFamily ? "família" : "equipe"}, ${ev.kind}`);
  return text("ok");
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
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(fn, "HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const body = await res.text();
    return body ? (JSON.parse(body) as unknown) : true;
  } catch (e) {
    console.error(fn, e instanceof Error ? e.name : "erro");
    return null;
  }
}

/** Uma rodada: classifica o que tem mensagem nova e roda o relógio. */
export async function runTick(
  env: Env,
  call: (fn: string, args: unknown) => Promise<unknown | null> = (fn, a) => rpc(env, fn, a),
  classifier: typeof classify = classify,
): Promise<{ classificadas: number; avisos: number }> {
  let classificadas = 0;
  if (env.OPENAI_API_KEY) {
    const pending = ((await call("triage_to_classify", { p_limit: 10 })) ?? []) as { episodio: string; upto: string; canal?: unknown; turma?: unknown; turnos?: unknown }[];
    for (const ep of Array.isArray(pending) ? pending : []) {
      const label = await classifier(env.OPENAI_API_KEY, env.OPENAI_MODEL, ep);
      if (!label) continue;
      const saved = await call("triage_save", {
        p_episode: ep.episodio,
        p_upto: ep.upto,
        p_label: label,
        p_model: env.OPENAI_MODEL,
        p_version: PROMPT_VERSION,
      });
      if (saved) classificadas++;
    }
  } else console.error("triagem: OPENAI_API_KEY ausente; nada classificado");
  const avisos = Number(await call("triage_tick", {})) || 0;
  return { classificadas, avisos };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      webhookSecret: env.WEBHOOK_SECRET ?? "",
      instance: env.EVOLUTION_INSTANCE,
      record: (args) => rpc(env, "triage_record", args),
    });
  },

  async scheduled(event: { cron?: string }, env: Env): Promise<void> {
    if (event.cron === "30 10 * * 1-5") {
      // 7h30 em São Paulo: resumo diário e, na segunda, também o semanal (P3).
      const monday = new Date().getUTCDay() === 1;
      const daily = await rpc(env, "triage_digests", { p_weekly: false });
      const weekly = monday ? await rpc(env, "triage_digests", { p_weekly: true }) : 0;
      console.log(`resumos: diário ${String(daily)}, semanal ${String(weekly)}`);
      return;
    }
    const r = await runTick(env);
    if (r.classificadas || r.avisos) console.log(`triagem: ${r.classificadas} classificada(s), ${r.avisos} aviso(s) pelo relógio`);
  },
};
