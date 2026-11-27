/**
 * Leitura do aviso "messages.upsert" da Evolution para a triagem. Diferente do
 * Luix, aqui interessam as DUAS direções: o que a família escreve e o que a
 * equipe responde pelo celular (fromMe), para saber o que ficou sem resposta.
 */

export interface VilaEvent {
  /** Telefone da família, em E.164 ("+5584999998888"). */
  phone: string;
  providerId: string;
  /** true = a família escreveu; false = a equipe respondeu. */
  fromFamily: boolean;
  kind: "text" | "audio" | "image" | "other";
  text: string;
  /** Quando a mensagem foi enviada (ISO), se a Evolution informou. */
  at: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function parseVilaEvent(payload: unknown): VilaEvent | null {
  const p = payload as { event?: unknown; data?: Record<string, unknown> } | null;
  if (!p || str(p.event).toLowerCase().replace(/_/g, ".") !== "messages.upsert") return null;
  const data = p.data;
  const key = data?.key as Record<string, unknown> | undefined;
  if (!data || !key) return null;

  // Grupos, transmissões, status e canais não são conversa com uma família.
  const remote = str(key.remoteJid);
  if (/@(g\.us|broadcast|newsletter)$/.test(remote) || remote.startsWith("status@")) return null;

  // O telefone vem no próprio endereço ou, em contas "@lid", num campo ao lado.
  const jid = [str(key.remoteJid), str(key.senderPn), str(key.remoteJidAlt), str(key.previousRemoteJid), str(data.remoteJidAlt)].find(
    (j) => j.endsWith("@s.whatsapp.net"),
  );
  if (!jid) return null;
  const digits = (jid.split("@")[0] ?? "").split(":")[0] ?? "";
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  const providerId = str(key.id);
  if (!providerId) return null;

  const ts = Number(data.messageTimestamp);
  const at = Number.isFinite(ts) && ts > 1_000_000_000 ? new Date(ts * 1000).toISOString() : null;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const base = { phone: `+${digits}`, providerId, fromFamily: key.fromMe !== true, at };

  const text = str(message.conversation) || str((message.extendedTextMessage as { text?: unknown } | undefined)?.text);
  if (text.trim()) return { ...base, kind: "text", text: text.trim().slice(0, 4000) };
  if (message.audioMessage) return { ...base, kind: "audio", text: "" };
  if (message.imageMessage) {
    const caption = str((message.imageMessage as { caption?: unknown }).caption).trim();
    return { ...base, kind: "image", text: caption.slice(0, 2000) };
  }
  // Reação, figurinha, edição, apagada: não muda a conversa.
  if (message.reactionMessage || message.protocolMessage || message.stickerMessage) return null;
  return { ...base, kind: "other", text: "" };
}
