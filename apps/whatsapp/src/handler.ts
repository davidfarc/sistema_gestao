/**
 * Atendimento pelo WhatsApp (SPEC-FASE2 §C).
 *
 * Recebe o webhook da Evolution, confere a senha e reconhece a pessoa pelo
 * telefone cadastrado. Quem é da equipe conversa com o agente (agent.ts); quem
 * não está cadastrado recebe uma orientação por dia. Sem a chave do modelo
 * configurada, a pessoa recebe só a confirmação fixa de recebimento.
 */

import { phoneVariants } from "../../../packages/core/src/phone.ts";

import { describeIgnored, parseInbound, type Inbound } from "./evolution.ts";

export interface InboundResult {
  /** Mensagem já recebida antes (a Evolution repete avisos): não responder. */
  duplicada: boolean;
  usuario: { id: string; nome: string } | null;
  /** Mensagens deste telefone na última hora (freio contra enxurrada). */
  recentes: number;
  /** Minutos desde a nossa última resposta a este telefone (null = nunca). */
  minutos_desde_resposta: number | null;
  /** Quantas vezes já respondemos a este número enquanto não cadastrado. */
  respostas_sem_cadastro?: number;
}

export interface Deps {
  webhookSecret: string;
  /**
   * Instância da Evolution que este agente atende (EVOLUTION_INSTANCE). Aviso de
   * outra instância (ex.: o WhatsApp da Gestão de Vila, só leitura) é ignorado:
   * o Luix nunca responde por um número que não é o dele.
   */
  instance?: string;
  appUrl: string;
  recordInbound(msg: Inbound, phones: string[]): Promise<InboundResult | null>;
  recordOutbound(phone: string, userId: string | null, body: string, error: string | null): Promise<void>;
  send(phone: string, text: string): Promise<string | null>;
  /** Resposta do agente para a pessoa (ausente = sem chave do modelo). */
  agent?(userId: string): Promise<string | null>;
  /**
   * Transcreve o áudio da mensagem e guarda o texto na conversa. Devolve false
   * se não conseguiu (ausente = áudio não habilitado).
   */
  transcribe?(msg: Inbound): Promise<boolean>;
  /**
   * Guarda a foto recebida e a deixa pendente para ir a um card. Devolve false
   * se não conseguiu (ausente = fotos não habilitadas).
   */
  storeImage?(msg: Inbound): Promise<boolean>;
  /** Deixa o trabalho continuar depois de responder ao webhook (`waitUntil`). */
  defer?(work: Promise<void>): void;
}

const MAX_PER_HOUR = 30;
const MAX_AUDIO_SECONDS = 180;
const MAX_UNKNOWN_REPLIES = 3;

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
    // Número não cadastrado: não conversa nem pede nada. Orienta até 3 vezes e
    // depois fica em silêncio, até a pessoa entrar no cadastro (C.2).
    if ((r.respostas_sem_cadastro ?? 0) >= MAX_UNKNOWN_REPLIES) return null;
    return (
      "Olá! Este é o atendimento automático da Eccoprime e só atende a equipe com telefone cadastrado no Sistema de Gestão. " +
      "O seu número não está cadastrado. Entre em contato com o gestor do serviço para regularizar o cadastro."
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
    // Sem mostrar a senha: só se veio alguma e de que tamanho, para conferir.
    console.log(
      `webhook recusado: senha ${given ? `diferente (${given.length} caracteres recebidos)` : "ausente"}; configurada no serviço: ${deps.webhookSecret ? `${deps.webhookSecret.length} caracteres` : "nenhuma"}`,
    );
    return text("não autorizado", 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return text("corpo inválido", 400);
  }
  const from = (payload as { instance?: unknown } | null)?.instance;
  if (deps.instance && typeof from === "string" && from.trim().toLowerCase() !== deps.instance.trim().toLowerCase()) {
    console.log("aviso de outra instância ignorado");
    return text("ignorado");
  }
  const msg = parseInbound(payload);
  // Sempre 200 para o que não nos interessa: a Evolution não deve repetir.
  if (!msg) {
    const why = describeIgnored(payload);
    const event = String((payload as { event?: unknown } | null)?.event ?? "?");
    console.log(why ? `mensagem ignorada (formato sem telefone?) ${JSON.stringify(why)}` : `aviso ignorado: ${event}`);
    return text("ignorado");
  }

  const result = await deps.recordInbound(msg, phoneVariants(msg.phone));
  if (!result) {
    console.error("entrada: o banco não registrou a mensagem");
    return text("indisponível", 503);
  }
  // Rastro de cada mensagem, sem dados pessoais: ajuda a ver onde parou.
  console.log(
    `entrada: ${msg.kind}, cadastrado=${result.usuario ? "sim" : "não"}, repetida=${result.duplicada ? "sim" : "não"}, na última hora=${result.recentes}`,
  );

  // Responde já ao webhook; a conversa com o modelo leva alguns segundos.
  const work = answer(msg, result, deps).catch((e) => {
    console.error("atendimento", e instanceof Error ? e.name : "erro");
  });
  if (deps.defer) deps.defer(work);
  else await work;
  return text("ok");
}

async function answer(msg: Inbound, result: InboundResult, deps: Deps): Promise<void> {
  const reply = await chooseReply(msg, result, deps);
  if (!reply) {
    console.log("resposta: nenhuma (silêncio de propósito)");
    return;
  }
  let error = await deps.send(msg.phone, reply);
  // Conversa no formato novo ("@lid"): se o WhatsApp recusar pelo número,
  // responde no próprio endereço da conversa.
  if (error?.startsWith("HTTP 400") && msg.chatJid && !msg.chatJid.endsWith("@s.whatsapp.net")) {
    console.log(`resposta: envio pelo número recusado (${error}); tentando pelo endereço da conversa`);
    error = await deps.send(msg.chatJid, reply);
  }
  console.log(error ? `resposta: o envio falhou (${error})` : "resposta: enviada");
  await deps.recordOutbound(msg.phone, result.usuario?.id ?? null, reply, error);
}

async function chooseReply(msg: Inbound, r: InboundResult, deps: Deps): Promise<string | null> {
  if (!r.usuario || !deps.agent) return replyFor(msg, r, deps.appUrl);
  if (r.duplicada || r.recentes > MAX_PER_HOUR) return null;
  if (msg.kind === "other") return "Por aqui eu só entendo texto, áudio e foto. Pode escrever ou gravar o seu pedido?";
  if (msg.kind === "image") {
    if (!deps.storeImage) return "Ainda não consigo receber fotos por aqui. Pode descrever em texto?";
    let stored = false;
    try {
      stored = await deps.storeImage(msg);
    } catch (e) {
      console.error("imagem", e instanceof Error ? e.name : "erro");
    }
    if (!stored) return "Não consegui guardar a foto (ela precisa ser JPG ou PNG de até 10 MB). Pode enviar de novo?";
  }
  if (msg.kind === "audio") {
    if (!deps.transcribe) return "Ainda não consigo ouvir áudio. Pode escrever o seu pedido em texto?";
    if ((msg.seconds ?? 0) > MAX_AUDIO_SECONDS) {
      return "Esse áudio ficou longo demais para mim. Pode mandar um mais curto (até 3 minutos) ou escrever?";
    }
    let heard = false;
    try {
      heard = await deps.transcribe(msg);
    } catch (e) {
      console.error("transcrição", e instanceof Error ? e.name : "erro");
    }
    if (!heard) return "Não consegui entender o áudio. Pode gravar de novo ou escrever o seu pedido?";
  }
  let reply: string | null = null;
  try {
    reply = await deps.agent(r.usuario.id);
  } catch (e) {
    console.error("agente", e instanceof Error ? e.name : "erro");
  }
  const site = deps.appUrl.replace(/^https?:\/\//, "");
  return reply ?? `Tive um problema para atender agora. Tente de novo em alguns minutos ou registre o pedido em ${site}.`;
}

export interface OutboxItem {
  id: string;
  phone: string;
  body: string;
}

export interface OutboxDeps {
  /** Enfileira os lembretes de card parado que estiverem na hora. */
  enqueueReminders(): Promise<void>;
  take(): Promise<OutboxItem[] | null>;
  done(id: string, error: string | null): Promise<void>;
  send(phone: string, text: string): Promise<string | null>;
}

/** Rotina de cada minuto: envia os avisos pendentes. Devolve quantos enviou. */
export async function deliverOutbox(deps: OutboxDeps): Promise<number> {
  await deps.enqueueReminders().catch(() => {});
  const items = (await deps.take()) ?? [];
  let sent = 0;
  for (const item of items) {
    if (typeof item?.id !== "string" || typeof item.phone !== "string" || !item.body) continue;
    const error = await deps.send(item.phone, item.body);
    await deps.done(item.id, error);
    if (!error) sent++;
  }
  return sent;
}
