// Gera o par de chaves VAPID das notificações push. Rodar UMA vez:
//   node infra/gen-vapid.mjs
// Cadastre os dois valores como segredos do Worker no Cloudflare
// (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY). Não salve em arquivo nem no Git.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey));
console.log("VAPID_PUBLIC_KEY  =", raw.toString("base64url"));
console.log("VAPID_PRIVATE_KEY =", jwk.d);
