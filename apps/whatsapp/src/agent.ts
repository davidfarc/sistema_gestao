/**
 * Agente de demandas (SPEC-FASE2 §C, etapa C2): conversa com a pessoa, pergunta
 * o que falta, confere se o pedido já existe e abre o card.
 *
 * O modelo (OpenAI, API de conversa com ferramentas) decide O QUE fazer; quem FAZ é o banco, pela função `whatsapp_agent`
 * (migration 0050), que roda com a identidade e as permissões de quem escreveu.
 * O agente não tem nenhuma outra porta: não move card, não apaga, não configura.
 */

import { AGENT_TOOLS, agentRules } from "../../../packages/core/src/whatsappAgent.ts";

/** Formato da API de conversa da OpenAI (Chat Completions), só o que usamos. */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ChatTool {
  type: "function";
  function: { name: string; description: string; strict: true; parameters: Record<string, unknown> };
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: ChatTool[];
}
export interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: ChatToolCall[] } }[];
}

export interface AgentContext {
  pessoa: string;
  hoje: string;
  pipelines: { id: string; nome: string; instrucoes: string; campos: unknown[] }[];
  conversa: { de: "pessoa" | "agente"; texto: string }[];
  /** Fotos que a pessoa mandou há pouco e ainda não foram para nenhum card. */
  imagens_pendentes?: number;
}

export interface AgentDeps {
  /** Chama `whatsapp_agent` como a pessoa. Devolve null se o banco falhar. */
  db(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  /**
   * Executa no site a liberação já conferida (move pelo CardService e atribui).
   * Ausente = liberação por mensagem indisponível.
   */
  release?(cardId: string, assigneeId: string | null): Promise<Record<string, unknown> | null>;
  /** Uma chamada ao modelo (injetável nos testes). Null se a API falhar. */
  model(request: ChatRequest): Promise<ChatResponse | null>;
  /** Nome do modelo da OpenAI (variável OPENAI_MODEL). */
  modelName: string;
  appUrl: string;
}

const MAX_TURNS = 6;

/** A orientação de cada ferramenta vem do core (o mesmo texto que o site mostra). */
function describe(name: string): string {
  const found = AGENT_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`Ferramenta sem descrição: ${name}`);
  return found.description;
}

const text = { type: "string" } as const;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatTool {
  return {
    type: "function",
    function: {
      name,
      description,
      strict: true,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

/** Campos do pipeline como lista de pares (o esquema fechado não aceita chaves livres). */
const CAMPOS = {
  type: "array",
  items: {
    type: "object",
    properties: { nome: text, valor: text },
    required: ["nome", "valor"],
    additionalProperties: false,
  },
} as const;

export const TOOLS: ChatTool[] = [
  tool(
    "buscar_pedidos",
    describe("buscar_pedidos"),
    { pipeline_id: text },
    ["pipeline_id"],
  ),
  tool(
    "criar_pedido",
    describe("criar_pedido"),
    {
      pipeline_id: text,
      titulo: { type: "string", description: "Curto e específico, com o local. Ex.: 'Ar-condicionado não liga - sala 12'." },
      descricao: { type: "string", description: "O que a pessoa relatou, com as palavras dela." },
      campos: CAMPOS,
    },
    ["pipeline_id", "titulo", "descricao", "campos"],
  ),
  tool(
    "reforcar_pedido",
    describe("reforcar_pedido"),
    {
      pipeline_id: text,
      numero: text,
      texto: { type: "string", description: "O que a pessoa relatou agora." },
      campos: CAMPOS,
      confirmado_pela_pessoa: {
        type: "boolean",
        description: "true somente quando a pessoa escolheu este número depois de você listar os pedidos iguais. Caso contrário, false.",
      },
    },
    ["pipeline_id", "numero", "texto", "campos", "confirmado_pela_pessoa"],
  ),
  tool(
    "liberar_pedido",
    describe("liberar_pedido"),
    { pipeline_id: text, numero: text, responsavel: text },
    ["pipeline_id", "numero", "responsavel"],
  ),
  tool(
    "comentar_pedido",
    describe("comentar_pedido"),
    { numero: text, texto: text, pipeline_id: text },
    ["numero", "texto", "pipeline_id"],
  ),
  tool(
    "anexar_imagens",
    describe("anexar_imagens"),
    { numero: text, legenda: text, pipeline_id: text },
    ["numero", "legenda", "pipeline_id"],
  ),
  tool(
    "situacao_pedido",
    describe("situacao_pedido"),
    { numero: text },
    ["numero"],
  ),
];

export function systemPrompt(ctx: AgentContext, appUrl: string): string {
  const site = appUrl.replace(/^https?:\/\//, "");
  const pipelines = ctx.pipelines.length
    ? JSON.stringify(ctx.pipelines, null, 1)
    : "(nenhum pipeline disponível para esta pessoa)";
  return [
    ...agentRules(site),
    "",
    `Quem escreve agora: ${ctx.pessoa}. Data e hora em São Paulo: ${ctx.hoje}.`,
    `Fotos que esta pessoa enviou há pouco e ainda não foram para nenhum pedido: ${ctx.imagens_pendentes ?? 0}.`,
    "",
    "## Pipelines que você atende para esta pessoa",
    pipelines,
  ].join("\n");
}

/** A conversa recente vira o histórico; a primeira mensagem tem de ser da pessoa. */
export function toMessages(conversa: AgentContext["conversa"]): ChatMessage[] {
  const start = conversa.findIndex((m) => m.de === "pessoa");
  if (start < 0) return [];
  return conversa.slice(start).map((m) =>
    m.de === "pessoa" ? { role: "user" as const, content: m.texto } : { role: "assistant" as const, content: m.texto },
  );
}

/** Lê os argumentos (texto JSON) de uma chamada de ferramenta. Null se inválidos. */
function toolArgs(name: string, raw: string): Record<string, unknown> | null {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    args = { ...(parsed as Record<string, unknown>) };
  } catch {
    return null;
  }
  if ((name === "criar_pedido" || name === "reforcar_pedido") && Array.isArray(args.campos)) {
    const campos: Record<string, string> = {};
    for (const c of args.campos as { nome?: unknown; valor?: unknown }[]) {
      if (typeof c?.nome === "string" && typeof c?.valor === "string") campos[c.nome] = c.valor;
    }
    args.campos = campos;
  }
  return args;
}

/** O que o texto afirma ter feito, por ferramenta que precisa ter dado certo. */
const CLAIMS: { tool: string; what: string; pattern: RegExp }[] = [
  {
    tool: "criar_pedido",
    what: "um pedido foi aberto",
    pattern: /\b(pedido|demanda|chamado|card)\b[^.!?\n]{0,60}\b(abert[oa]|criad[oa]|registrad[oa]|cadastrad[oa])\b|\b(abri|criei|registrei|cadastrei)\b[^.!?\n]{0,40}\b(pedido|demanda|chamado|card)\b/i,
  },
  {
    tool: "liberar_pedido",
    what: "um pedido foi liberado",
    pattern: /\b(pedido|demanda|card)\b[^.!?\n]{0,60}\b(liberad[oa])\b|\bliberei\b/i,
  },
  {
    tool: "comentar_pedido",
    what: "uma atualização foi registrada no pedido",
    pattern: /\b(coment[áa]rio|atualiza[çc][ãa]o|novidade)\b[^.!?\n]{0,40}\b(registrad[oa]|anotad[oa]|adicionad[oa])\b|\b(registrei|anotei)\b[^.!?\n]{0,40}\b(coment[áa]rio|atualiza[çc][ãa]o|novidade|no card|no pedido)\b/i,
  },
];

/**
 * O texto PROMETE fazer algo ("vou registrar o reforço") em vez de ter feito?
 * Uma promessa sem pergunta encerra a conversa com a pessoa achando que está
 * resolvido, e nada acontece: o agente só age dentro da própria resposta.
 */
export function emptyPromise(reply: string, done: ReadonlySet<string>): boolean {
  if (
    done.has("criar_pedido") ||
    done.has("reforcar_pedido") ||
    done.has("comentar_pedido") ||
    done.has("liberar_pedido") ||
    done.has("anexar_imagens")
  ) {
    return false;
  }
  // Se termina perguntando algo, a promessa depende da resposta da pessoa: tudo bem.
  if (/\?\s*$/.test(reply.trim())) return false;
  return /\b(vou|irei|j[áa] vou|estou|deixa que eu|pode deixar que)\s+(j[áa]\s+)?(registr|abr|cri|refor[çc]|liber|anot|inclu|adicion|coment|encaminh)\w*/i.test(
    reply,
  );
}

/** Números de pedido que aparecem numa resposta de ferramenta (campo "numero"). */
function collectNumbers(value: unknown, into: Set<number>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "numero" && Number.isFinite(Number(v))) into.add(Number(v));
      else collectNumbers(v, into);
    }
  }
}

/**
 * Devolve o que o texto afirma ter feito sem respaldo de ferramenta, ou null.
 *
 * Regra: se a frase de confirmação cita números de pedido, todos têm de ter
 * vindo de uma ferramenta nesta rodada (assim nunca se anuncia um pedido que
 * não existe). Sem número, vale só se a ferramenta de escrita deu certo.
 */
export function unbackedClaim(reply: string, done: ReadonlySet<string>, known: ReadonlySet<number>): string | null {
  // Negações e perguntas ("não foi aberto", "quer que eu abra?") não são confirmação.
  const text = reply.replace(/\b(n[ãa]o|nenhum)\b[^.!?\n]*/gi, " ").replace(/[^.!?\n]*\?/g, " ");
  const claim = CLAIMS.find((c) => c.pattern.test(text));
  if (!claim) return null;
  const mentioned = [...text.matchAll(/#\s*(\d{1,9})|\b(?:pedido|demanda|chamado|card)\s+(?:n[ºo.]*\s*)?(\d{1,9})\b/gi)].map((m) =>
    Number(m[1] ?? m[2]),
  );
  if (mentioned.length > 0) return mentioned.every((n) => known.has(n)) ? null : claim.what;
  const wrote =
    done.has("criar_pedido") || done.has("reforcar_pedido") || done.has("comentar_pedido") || done.has("anexar_imagens");
  return done.has(claim.tool) || (claim.tool !== "liberar_pedido" && wrote) ? null : claim.what;
}

/**
 * Executa uma ferramenta. Quase todas são uma chamada ao banco; a liberação tem
 * dois passos: o banco confere e escolhe o responsável, e o site move o card
 * (as regras de movimentação vivem só lá).
 */
async function runTool(deps: AgentDeps, name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  // A busca devolve todos os abertos: quem compara é o modelo. Um filtro de
  // texto escolhido por ele já deixou passar pedido repetido.
  if (name === "buscar_pedidos") return deps.db(name, { pipeline_id: args.pipeline_id, texto: "" });
  if (name !== "liberar_pedido") return deps.db(name, args);
  if (!deps.release) return { erro: "A liberação por mensagem não está disponível. Libere pelo site." };
  const plan = await deps.db("preparar_liberacao", args);
  if (!plan || typeof plan.erro === "string" || typeof plan.card_id !== "string") return plan;
  const result = await deps.release(plan.card_id, typeof plan.assignee_id === "string" ? plan.assignee_id : null);
  // O número conferido pelo banco acompanha a resposta do site.
  return result && typeof result.erro !== "string" ? { numero: plan.numero, ...result } : result;
}

/**
 * Roda o agente para a última mensagem da pessoa. Devolve o texto da resposta,
 * ou null se não deu (o chamador manda a resposta de contingência).
 */
export async function runAgent(deps: AgentDeps): Promise<string | null> {
  const ctx = (await deps.db("contexto", {})) as unknown as AgentContext | null;
  if (!ctx || !Array.isArray(ctx.conversa)) return null;
  const history = toMessages(ctx.conversa);
  if (history.length === 0 || history[history.length - 1]!.role !== "user") return null;
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(ctx, deps.appUrl) }, ...history];

  const done = new Set<string>();
  const numbers = new Set<number>();
  let corrected = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await deps.model({ model: deps.modelName, messages, tools: TOOLS });
    const choice = res?.choices?.[0];
    const message = choice?.message;
    if (!choice || !message) return null;

    const calls = message.tool_calls ?? [];
    if (calls.length > 0) {
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name ?? "";
        const known = TOOLS.some((t) => t.function.name === name);
        const args = known ? toolArgs(name, call.function.arguments) : null;
        const out = !known
          ? { erro: "Ferramenta desconhecida." }
          : !args
            ? { erro: "Argumentos inválidos." }
            : ((await runTool(deps, name, args)) ?? { erro: "O sistema não respondeu. Peça para tentar de novo em instantes." });
        if (typeof out.erro !== "string") {
          done.add(name);
          collectNumbers(out, numbers);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
      }
      continue;
    }

    // Recusa, corte por tamanho ou filtro de conteúdo: melhor a contingência.
    if (choice.finish_reason !== "stop" || message.refusal) return null;
    const reply = (message.content ?? "").trim();
    if (!reply) return null;

    // Trava contra confirmação inventada: se o texto afirma que algo foi feito
    // e nenhuma ferramenta correspondente deu certo nesta rodada, o modelo é
    // cobrado uma vez; se insistir, vai a contingência (nunca a falsa confirmação).
    if (emptyPromise(reply, done)) {
      console.error("agente: prometeu sem fazer");
      if (corrected) return null;
      corrected = true;
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content:
          "[aviso do sistema, não é a pessoa] Você disse que VAI fazer, mas não chamou a ferramenta, e depois desta resposta nada mais acontece sozinho. Faça agora, nesta rodada, com o que a pessoa já informou (use o relato dela como texto), e só então responda confirmando. Se realmente faltar um dado, pergunte.",
      });
      continue;
    }
    const claim = unbackedClaim(reply, done, numbers);
    if (claim) {
      console.error("agente: confirmação sem ferramenta:", claim);
      if (corrected) return null;
      corrected = true;
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content: `[aviso do sistema, não é a pessoa] Sua resposta afirma que ${claim}, mas a ferramenta correspondente não foi chamada com sucesso nesta rodada, então nada foi feito. Chame a ferramenta agora (se já tiver os dados) ou responda à pessoa sem afirmar que foi feito.`,
      });
      continue;
    }
    return reply.slice(0, 3500);
  }
  return null;
}

/** Chamada real à OpenAI. Devolve null em qualquer falha (o agente trata). */
export async function callOpenAI(apiKey: string, request: ChatRequest, fetcher: typeof fetch = fetch): Promise<ChatResponse | null> {
  try {
    const res = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      // O corpo do erro da OpenAI não traz a chave; ajuda a ver modelo errado ou falta de crédito.
      console.error("openai HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return (await res.json()) as ChatResponse;
  } catch (e) {
    console.error("openai", e instanceof Error ? e.name : "erro");
    return null;
  }
}

const TRANSCRIBE_PROMPT =
  "Áudio em português do Brasil, de um funcionário de uma escola pedindo um serviço (manutenção, informática, eventos). Pode citar o número de uma sala.";

/**
 * Transcreve um áudio pela OpenAI. Devolve o texto, ou null em qualquer falha.
 * O arquivo vai só na chamada; não é guardado em lugar nenhum.
 */
export async function transcribeOpenAI(
  apiKey: string,
  model: string,
  audio: { bytes: Uint8Array; mimetype: string },
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const ext = audio.mimetype.includes("mp4") || audio.mimetype.includes("m4a") ? "m4a" : audio.mimetype.includes("mpeg") ? "mp3" : "ogg";
    const form = new FormData();
    form.append("model", model);
    // Contexto em texto livre. O modelo atual não aceita mais o campo "language".
    form.append("prompt", TRANSCRIBE_PROMPT);
    form.append("file", new Blob([audio.bytes as BlobPart], { type: audio.mimetype }), `audio.${ext}`);
    const res = await fetcher("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error("openai transcrição HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { text?: unknown };
    const out = typeof data.text === "string" ? data.text.trim() : "";
    return out ? out.slice(0, 3500) : null;
  } catch (e) {
    console.error("openai transcrição", e instanceof Error ? e.name : "erro");
    return null;
  }
}
