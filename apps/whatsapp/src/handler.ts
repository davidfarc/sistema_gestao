/**
 * Atendimento pelo WhatsApp — base (SPEC-FASE2 §C, etapa C1).
 *
 * Recebe o webhook da Evolution, confere a senha, reconhece a pessoa pelo
 * telefone cadastrado e responde. Nesta etapa a resposta é fixa: confirma o
 * recebimento a quem é da equipe e orienta quem não está cadastrado. O agente
 * que abre demandas (C2) entra no lugar de `replyFor`.
 */

import { phoneVariants } from "../../../packages/core/src/phone.ts";

import { parseInbound, type Inbound } from "./evolution.ts";

export interface InboundResult {
  /** Mensagem já recebida antes (a Evolution repete avisos): não responder. */
  duplicada: boolean;
  usuario: { id: string; nome: string } | null;
  /** Mensagens deste telefone na última hora (freio contra enxurrada). */
  recentes: number;
  /** Minutos desde a nossa última resposta a este telefone (null = nunca). */
  minutos_desde_resposta: number | null;
}

export interface Deps {
  webhookSecret: string;
  appUrl: string;
  recordInbound(msg: Inbound, phones: string[]): Promise<InboundResult | null>;
  recordOutbound(phone: string, userId: string | null, body: string, error: string | null): Promise<void>;
  send(phone: string, text: string): Promise<string | null>;
}

const MAX_PER_HOUR = 30;

/** Comparação em tempo constante (não revela a senha pelo tempo de resposta). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

/** Texto da resposta, ou null para ficar em silêncio. */
export function replyFor(msg: Inbound, r: InboundResult, appUrl: string): string | null {
  if (r.duplicada || r.recentes > MAX_PER_HOUR) return null;
  const site = appUrl.replace(/^https?:\/\//, "");
  if (!r.usuario) {
    // Número desconhecido: uma orientação por dia, e nada mais (C.2).
    if (r.minutos_desde_resposta !== null && r.minutos_desde_resposta < 24 * 60) return null;
    return (
      "Olá! Este é o atendimento automático da Eccoprime e só atende telefones cadastrados no Sistema de Gestão. " +
      `Se você é da equipe, cadastre o seu celular em ${site} (Avisos → Meu telefone) e escreva de novo.`
    );
  }
  // Fase de testes: uma confirmação a cada 10 minutos, para não repetir a cada frase.
  if (r.minutos_desde_resposta !== null && r.minutos_desde_resposta < 10) return null;
  const nome = r.usuario.nome.trim().split(/\s+/)[0] || "";
  const oi = nome ? `Olá, ${nome}!` : "Olá!";
  const recebi = msg.kind === "audio" ? "Recebi o seu áudio." : "Recebi a sua mensagem.";
  return (
    `${oi} ${recebi} O atendimento por aqui ainda está em fase de testes e não abre pedidos sozinho. ` +
    `Por enquanto, registre a sua demanda em ${site}.`
  );
}

const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/robots.txt") return text("User-agent: *\nDisallow: /\n");
  if (request.method === "GET" && url.pathname === "/") return text("ok");

  const m = /^\/webhook(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!m || request.method !== "POST") return text("não encontrado", 404);
  const given = m[1] ? decodeURIComponent(m[1]) : (request.headers.get("x-webhook-secret") ?? "");
  if (!deps.webhookSecret || deps.webhookSecret.length < 24 || !safeEqual(given, deps.webhookSecret)) {
    return text("não autorizado", 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return text("corpo inválido", 400);
  }
  const msg = parseInbound(payload);
  // Sempre 200 para o que não nos interessa: a Evolution não deve repetir.
  if (!msg) return text("ignorado");

  const result = await deps.recordInbound(msg, phoneVariants(msg.phone));
  if (!result) return text("indisponível", 503);
  const reply = replyFor(msg, result, deps.appUrl);
  if (!reply) return text("ok");
  const error = await deps.send(msg.phone, reply);
  await deps.recordOutbound(msg.phone, result.usuario?.id ?? null, reply, error);
  return text("ok");
}
