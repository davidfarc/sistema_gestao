/**
 * Worker `ecco-whatsapp`: liga o atendimento (handler.ts) à Evolution API e ao
 * banco da Ecco. As funções `whatsapp_*` (migration 0049) só aceitam a chave de
 * servidor, guardada como segredo do Cloudflare.
 */

import { callOpenAI, runAgent, transcribeOpenAI } from "./agent.ts";
import { accessToken, archiveToDrive, createFile, createFolder, type DriveConfig, type DriveJob } from "./drive.ts";
import { fetchMedia, MAX_IMAGE_BYTES, sendText, type EvolutionConfig } from "./evolution.ts";
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
  /** Conta de serviço do Google e pasta-raiz, para guardar evidências no Drive (opcional). */
  GOOGLE_SA_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY?: string;
  DRIVE_ROOT_FOLDER_ID?: string;
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
    // Função sem retorno responde vazio (204): deu certo, só não há o que ler.
    const body = await res.text();
    return body ? (JSON.parse(body) as unknown) : true;
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

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Guarda a imagem no armazenamento de imagens dos cards (bucket `card-images`,
 * o mesmo das imagens coladas na descrição). Devolve o endereço público, com
 * nome aleatório, ou null se o tipo não for aceito ou o envio falhar.
 */
async function uploadImage(env: Env, bytes: Uint8Array, mimetype: string): Promise<string | null> {
  const ext = IMAGE_EXT[mimetype];
  if (!ext) {
    console.error("imagem: tipo não aceito", mimetype.slice(0, 40));
    return null;
  }
  const path = `whatsapp/${crypto.randomUUID()}.${ext}`;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/card-images/${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": mimetype === "image/jpg" ? "image/jpeg" : mimetype,
      },
      body: bytes as BodyInit,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error("imagem: armazenamento HTTP", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return `${env.SUPABASE_URL}/storage/v1/object/public/card-images/${path}`;
  } catch (e) {
    console.error("imagem: armazenamento", e instanceof Error ? e.name : "erro");
    return null;
  }
}

/** Baixa uma foto que nós mesmos guardamos (só do nosso armazenamento de imagens). */
async function downloadStored(env: Env, url: string): Promise<{ bytes: Uint8Array; mimetype: string } | null> {
  if (!url.startsWith(`${env.SUPABASE_URL}/storage/v1/object/public/card-images/`)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    return { bytes, mimetype: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim() };
  } catch {
    return null;
  }
}

type Out = Record<string, unknown> | null;
/** Ferramentas da rotina da Gestão de Vila (migration 0057). */
const ROUTINE_TOOLS = new Set(["buscar_aluno", "registrar_rotina"]);

/**
 * Porta do agente para o banco. Pedidos vão para `whatsapp_agent`; a rotina
 * dos alunos para `whatsapp_routine`. O contexto junta os dois: sem a 0057,
 * a parte da rotina falha e o agente segue só com as demandas.
 */
async function agentDb(env: Env, userId: string, tool: string, args: Record<string, unknown>): Promise<Out> {
  const call = (fn: string, t: string, a: unknown) => rpc(env, fn, { p_user: userId, p_tool: t, p_args: a }) as Promise<Out>;
  if (tool === "contexto") {
    const [ctx, routine] = await Promise.all([call("whatsapp_agent", "contexto", {}), call("whatsapp_routine", "rotina_contexto", {})]);
    return ctx ? { ...ctx, ...(routine && typeof routine.erro !== "string" ? routine : {}) } : null;
  }
  return call(ROUTINE_TOOLS.has(tool) ? "whatsapp_routine" : "whatsapp_agent", tool, args);
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
      // Fotos não dependem do modelo, mas só fazem sentido com o agente ligado.
      storeImage: openaiKey
        ? async (msg) => {
            const media = msg.media ? await fetchMedia(evolution, msg.media, fetch, MAX_IMAGE_BYTES) : null;
            if (!media) return false;
            const url = await uploadImage(env, media.bytes, media.mimetype);
            if (!url) return false;
            const saved = await rpc(env, "whatsapp_media_add", {
              p_provider_id: msg.providerId,
              p_url: url,
              p_caption: msg.text,
            });
            if (saved !== true) console.error("foto não registrada (migration 0055 aplicada?)");
            return saved === true;
          }
        : undefined,
      agent: openaiKey
        ? (userId) =>
            runAgent({
              appUrl: env.APP_URL,
              db: (tool, args) => agentDb(env, userId, tool, args),
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

    // Evidências no Google Drive (migration 0056): só com a credencial configurada.
    const driveSecrets = {
      GOOGLE_SA_EMAIL: env.GOOGLE_SA_EMAIL,
      GOOGLE_SA_PRIVATE_KEY: env.GOOGLE_SA_PRIVATE_KEY,
      DRIVE_ROOT_FOLDER_ID: env.DRIVE_ROOT_FOLDER_ID,
    };
    const missing = Object.entries(driveSecrets).filter(([, v]) => !v).map(([k]) => k);
    // Diz no log, a cada rodada, por que o Drive está parado (só os nomes, nunca os valores).
    if (missing.length > 0) console.log("drive: desligado, falta o segredo", missing.join(", "));
    if (env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.DRIVE_ROOT_FOLDER_ID) {
      const drive: DriveConfig = {
        clientEmail: env.GOOGLE_SA_EMAIL,
        privateKey: env.GOOGLE_SA_PRIVATE_KEY,
        rootFolderId: env.DRIVE_ROOT_FOLDER_ID,
      };
      await archiveToDrive({
        rootFolderId: drive.rootFolderId,
        take: async () => (await rpc(env, "whatsapp_drive_take", { p_limit: 3 })) as DriveJob[] | null,
        token: () => accessToken(drive),
        createFolder: (token, name, parentId) => createFolder(token, name, parentId),
        createFile: (token, file, parentId) => createFile(token, file, parentId),
        download: (url) => downloadStored(env, url),
        saveLevel: async (boardId, path, folderId) =>
          void (await rpc(env, "whatsapp_drive_folder", { p_board: boardId, p_path: path, p_folder_id: folderId })),
        saveCard: async (cardId, folderId) => void (await rpc(env, "whatsapp_drive_card", { p_card: cardId, p_folder_id: folderId })),
        saveImage: async (mediaId) => void (await rpc(env, "whatsapp_drive_image", { p_media: mediaId })),
      })
        .then((n) => console.log("drive: pedidos gravados nesta rodada:", n))
        .catch((e) => console.error("drive", e instanceof Error ? e.name : "erro"));
    }
  },
};
