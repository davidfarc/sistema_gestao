import assert from "node:assert/strict";
import { test } from "node:test";

import {
  base64UrlDecode,
  base64UrlEncode,
  buildPushRequest,
  encryptPushPayload,
  generateVapidKeys,
  vapidAuthorization,
} from "./webpush.ts";

const enc = new TextEncoder();
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type KeyPair = { publicKey: Key; privateKey: Key };

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8),
  );
}

/** Um "navegador" de mentira: gera a inscrição e sabe decifrar (lado receptor do RFC 8291). */
async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as KeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys: { p256dh: base64UrlEncode(uaPublic), auth: base64UrlEncode(auth) },
    async decrypt(body: Uint8Array<ArrayBuffer>): Promise<string> {
      const salt = body.slice(0, 16);
      const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
      assert.equal(recordSize, 4096);
      const idLen = body[20]!;
      assert.equal(idLen, 65);
      const asPublic = body.slice(21, 21 + idLen);
      const ciphertext = body.slice(21 + idLen);
      const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, pair.privateKey, 256),
      );
      const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
      const ikm = await hkdf(auth, shared, info, 32);
      const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
      const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
      assert.equal(plain[plain.length - 1], 2, "delimitador de último registro");
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

test("base64url ida e volta, sem preenchimento", () => {
  const bytes = new Uint8Array([251, 255, 0, 1, 2, 62, 63]);
  const text = base64UrlEncode(bytes);
  assert.doesNotMatch(text, /[+/=]/);
  assert.deepEqual([...base64UrlDecode(text)], [...bytes]);
});

test("o navegador de destino decifra o que foi cifrado", async () => {
  const browser = await fakeBrowser();
  const message = JSON.stringify({ title: "Ana mencionou você", body: "ação — çãõ 🚀" });
  const body = await encryptPushPayload(browser.keys, enc.encode(message));
  assert.equal(await browser.decrypt(body), message);
});

test("cada envio usa salt e chave descartável novos", async () => {
  const browser = await fakeBrowser();
  const a = await encryptPushPayload(browser.keys, enc.encode("x"));
  const b = await encryptPushPayload(browser.keys, enc.encode("x"));
  assert.notDeepEqual([...a], [...b]);
});

test("outro navegador não decifra", async () => {
  const alvo = await fakeBrowser();
  const curioso = await fakeBrowser();
  const body = await encryptPushPayload(alvo.keys, enc.encode("segredo"));
  await assert.rejects(() => curioso.decrypt(body));
});

test("VAPID: JWT ES256 válido, com audiência = origem do serviço de push", async () => {
  const vapid = { ...(await generateVapidKeys()), subject: "mailto:ti@example.com" };
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, 1_800_000_000);
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match);
  const [h, p, s] = match[1]!.split(".");
  assert.equal(match[2], vapid.publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(h!))), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(p!))), {
    aud: "https://fcm.googleapis.com",
    exp: 1_800_000_000 + 12 * 3600,
    sub: "mailto:ti@example.com",
  });
  const publicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(vapid.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64UrlDecode(s!),
    enc.encode(`${h}.${p}`),
  );
  assert.equal(ok, true);
});

test("buildPushRequest monta cabeçalhos e corpo decifrável", async () => {
  const browser = await fakeBrowser();
  const vapid = { ...(await generateVapidKeys()), subject: "mailto:ti@example.com" };
  const req = await buildPushRequest(
    { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz", ...browser.keys },
    { title: "Oi" },
    vapid,
  );
  assert.equal(req.headers["Content-Encoding"], "aes128gcm");
  assert.equal(req.headers.TTL, "86400");
  assert.match(req.headers.Authorization!, /^vapid t=/);
  assert.equal(await browser.decrypt(req.body), '{"title":"Oi"}');
});

test("chaves de inscrição malformadas são recusadas", async () => {
  await assert.rejects(() => encryptPushPayload({ p256dh: "AAAA", auth: "AAAA" }, enc.encode("x")));
});
