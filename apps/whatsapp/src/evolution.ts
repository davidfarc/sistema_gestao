/**
 * Provedor do WhatsApp: Evolution API (SPEC-FASE2 §C). Tudo o que é específico
 * dela fica neste arquivo; o resto do Worker só conhece `Inbound` e `sendText`,
 * para dar para trocar de provedor sem reescrever o atendimento.
 */

export interface Inbound {
  /** Telefone de quem escreveu, em E.164 ("+5584999998888"). */
  phone: string;
  /** Identificador da mensagem no WhatsApp (evita processar duas vezes). */
  providerId: string;
  kind: "text" | "audio" | "other";
  text: string;
  /** Duração do áudio em segundos, quando o WhatsApp informa. */
  seconds?: number;
  /**
   * Só em áudio: a mensagem como a Evolution entregou (chave + conteúdo). É o
   * que ela precisa para devolver o arquivo, já que não guardamos mensagens lá.
   */
  media?: { key: unknown; message: unknown; base64?: string; mimetype?: string };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Lê o aviso "messages.upsert" da Evolution. Devolve null para tudo o que não
 * é mensagem de uma pessoa para nós: outros eventos, mensagens enviadas pelo
 * próprio número, grupos, listas de transmissão e status.
 */
export function parseInbound(payload: unknown): Inbound | null {
  const p = payload as { event?: unknown; data?: Record<string, unknown> } | null;
  if (!p || str(p.event).toLowerCase().replace(/_/g, ".") !== "messages.upsert") return null;
  const data = p.data;
  const key = data?.key as Record<string, unknown> | undefined;
  if (!data || !key || key.fromMe === true) return null;

  // Contas novas chegam como "…@lid" (identificador interno); o telefone vem ao lado.
  const jid = [str(key.remoteJid), str(key.senderPn), str(key.remoteJidAlt)].find((j) =>
    j.endsWith("@s.whatsapp.net"),
  );
  if (!jid) return null;
  const digits = (jid.split("@")[0] ?? "").split(":")[0] ?? "";
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  const providerId = str(key.id);
  if (!providerId) return null;

  const message = (data.message ?? {}) as Record<string, unknown>;
  const text =
    str(message.conversation) || str((message.extendedTextMessage as { text?: unknown } | undefined)?.text);
  if (text.trim()) return { phone: `+${digits}`, providerId, kind: "text", text: text.trim().slice(0, 4000) };
  if (message.audioMessage) {
    const seconds = Number((message.audioMessage as { seconds?: unknown }).seconds);
    return {
      phone: `+${digits}`,
      providerId,
      kind: "audio",
      text: "",
      ...(Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}),
      media: {
        key,
        message,
        // Com "Base64" ligado no webhook, o arquivo já vem junto.
        ...(str(message.base64) ? { base64: str(message.base64) } : {}),
        mimetype: str((message.audioMessage as { mimetype?: unknown }).mimetype) || "audio/ogg",
      },
    };
  }
  return { phone: `+${digits}`, providerId, kind: "other", text: "" };
}

export interface EvolutionConfig {
  url: string;
  instance: string;
  apiKey: string;
  /**
   * Credencial de serviço do Cloudflare Access (opcional). Com ela, o endereço
   * do gateway fica fechado na internet e só este Worker passa pela porta.
   */
  accessClientId?: string;
  accessClientSecret?: string;
}

function headers(cfg: EvolutionConfig): Record<string, string> {
  return {
    apikey: cfg.apiKey,
    "Content-Type": "application/json",
    ...(cfg.accessClientId && cfg.accessClientSecret
      ? { "CF-Access-Client-Id": cfg.accessClientId, "CF-Access-Client-Secret": cfg.accessClientSecret }
      : {}),
  };
}

export interface Media {
  bytes: Uint8Array;
  mimetype: string;
}

/** Tamanho máximo do áudio aceito (cerca de 5 minutos de voz no WhatsApp). */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function decode(b64raw: string, mimetype: string): Media | null {
  const b64 = b64raw.replace(/^data:[^,]*,/, "");
  if (!b64 || b64.length > (MAX_AUDIO_BYTES * 4) / 3 + 8) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimetype: (mimetype || "audio/ogg").split(";")[0]!.trim() };
  } catch {
    return null;
  }
}

/**
 * Arquivo de uma mensagem de áudio. Usa o que veio no webhook, se veio; senão
 * pede à Evolution, mandando a mensagem inteira (ela não a tem guardada).
 * Null se não der.
 */
export async function fetchMedia(
  cfg: EvolutionConfig,
  media: NonNullable<Inbound["media"]>,
  fetcher: typeof fetch = fetch,
): Promise<Media | null> {
  if (media.base64) return decode(media.base64, media.mimetype ?? "");
  try {
    const res = await fetcher(
      `${cfg.url.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(cfg.instance)}`,
      {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify({ message: { key: media.key, message: media.message }, convertToMp4: false }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      console.error("evolution mídia HTTP", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { base64?: unknown; mimetype?: unknown };
    if (typeof data.base64 !== "string") {
      console.error("evolution mídia: resposta sem arquivo");
      return null;
    }
    return decode(data.base64, typeof data.mimetype === "string" ? data.mimetype : (media.mimetype ?? ""));
  } catch (e) {
    console.error("evolution mídia", e instanceof Error ? e.name : "erro");
    return null;
  }
}

/** Envia um texto. Devolve null se deu certo, ou a descrição curta da falha. */
export async function sendText(
  cfg: EvolutionConfig,
  phone: string,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(
      `${cfg.url.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`,
      {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify({ number: phone.replace(/\D/g, ""), text }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return e instanceof Error ? e.name : "falha de rede";
  }
}
