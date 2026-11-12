/**
 * Web Push sem dependências: monta a requisição que entrega uma notificação a
 * um navegador inscrito. Usa só WebCrypto (existe no Cloudflare Workers, no
 * Node 20+ e nos navegadores).
 *
 * - Conteúdo cifrado no formato `aes128gcm` (RFC 8291 + RFC 8188): só o
 *   navegador de destino consegue ler; o serviço de push (Google, Apple,
 *   Mozilla) apenas repassa.
 * - Identificação do remetente por VAPID (RFC 8292): um JWT ES256 assinado com
 *   a chave privada do sistema.
 */

export interface PushSubscriptionKeys {
  /** URL do serviço de push para este navegador. */
  endpoint: string;
  /** Chave pública do navegador (P-256, ponto não comprimido, base64url). */
  p256dh: string;
  /** Segredo de autenticação do navegador (16 bytes, base64url). */
  auth: string;
}

export interface VapidKeys {
  /** Chave pública (P-256, ponto não comprimido de 65 bytes, base64url). */
  publicKey: string;
  /** Chave privada (escalar de 32 bytes, base64url). SEGREDO. */
  privateKey: string;
  /** Contato do remetente: `mailto:...` ou uma URL https. */
  subject: string;
}

export interface PushRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

type Bytes = Uint8Array<ArrayBuffer>;
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type KeyPair = { publicKey: Key; privateKey: Key };

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Bytes {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Cabeçalho `Authorization` do VAPID para o serviço de push dono do `endpoint`. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const pub = base64UrlDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("Chave pública VAPID inválida.");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: base64UrlEncode(pub.slice(1, 33)),
      y: base64UrlEncode(pub.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const part = (obj: unknown) => base64UrlEncode(encoder.encode(JSON.stringify(obj)));
  const unsigned =
    part({ typ: "JWT", alg: "ES256" }) +
    "." +
    part({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: vapid.subject });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

/** Cifra `plaintext` para o navegador da inscrição (corpo `aes128gcm`, um registro). */
export async function encryptPushPayload(
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array,
): Promise<Bytes> {
  const uaPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Chave p256dh inválida.");
  if (authSecret.length !== 16) throw new Error("Segredo auth inválido.");

  // Par de chaves descartável desta mensagem + segredo compartilhado (ECDH).
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as KeyPair;
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );

  const ikm = await hkdf(
    authSecret,
    shared,
    concat(encoder.encode("WebPush: info\0"), uaPublic, localPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 = delimitador de "último registro".
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  // Cabeçalho: salt(16) | tamanho do registro(4) | tam. da chave(1) | chave(65).
  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, ciphertext);
}

/**
 * Requisição pronta para `fetch`. `payload` vira JSON; o service worker do
 * navegador o recebe no evento `push`. Limite prático do corpo: ~3 KB.
 */
export async function buildPushRequest(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<PushRequest> {
  const body = await encryptPushPayload(subscription, encoder.encode(JSON.stringify(payload)));
  return {
    endpoint: subscription.endpoint,
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttlSeconds ?? 24 * 3600),
      Urgency: options.urgency ?? "normal",
    },
    body,
  };
}

/** Gera um par de chaves VAPID (rodar uma vez; ver infra/gen-vapid.mjs). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as KeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: base64UrlEncode(raw), privateKey: jwk.d! };
}
