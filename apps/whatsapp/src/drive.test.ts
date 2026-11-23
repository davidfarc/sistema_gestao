import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { test } from "node:test";

import { accessToken, archiveToDrive, createFile, createFolder, signJwt, type ArchiveDeps, type DriveJob } from "./drive.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const cfg = { clientEmail: "robo@projeto.iam.gserviceaccount.com", privateKey, rootFolderId: "RAIZ" };

test("signJwt: assinatura válida, só o necessário nas declarações", async () => {
  const jwt = await signJwt(cfg, 1_700_000_000);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h!, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
  assert.equal(claims.iss, cfg.clientEmail);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url")), true);
  // A chave também funciona como vem colada de um JSON, com "\n" escrito.
  assert.equal((await signJwt({ ...cfg, privateKey: privateKey.replace(/\n/g, "\\n") }, 1)).split(".").length, 3);
});

test("accessToken: troca o JWT pelo token; null se o Google recusar", async () => {
  let body = "";
  const ok = (async (_u: string, init: RequestInit) => {
    body = String(init.body);
    return new Response(JSON.stringify({ access_token: "tok" }));
  }) as unknown as typeof fetch;
  assert.equal(await accessToken(cfg, ok), "tok");
  assert.match(body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  const bad = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
  assert.equal(await accessToken(cfg, bad), null);
});

test("createFolder e createFile: só criação, com suporte a drive compartilhado", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ id: "novo" }));
  }) as unknown as typeof fetch;
  assert.equal(await createFolder("tok", "3º ano", "RAIZ", ok), "novo");
  assert.equal(await createFile("tok", { name: "erro.txt", mimetype: "text/plain", bytes: new TextEncoder().encode("oi") }, "P", ok), "novo");
  for (const s of seen) {
    assert.equal(s.init.method, "POST");
    assert.match(s.url, /supportsAllDrives=true/);
    assert.equal((s.init.headers as Record<string, string>).Authorization, "Bearer tok");
  }
  assert.deepEqual(JSON.parse(seen[0]!.init.body as string), {
    name: "3º ano",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["RAIZ"],
  });
  const multipart = new TextDecoder().decode(seen[1]!.init.body as Uint8Array);
  assert.match(multipart, /"name":"erro.txt","parents":\["P"\]/);
  assert.match(multipart, /\r\n\r\noi\r\n--ecco/);
  const bad = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
  assert.equal(await createFolder("tok", "x", "RAIZ", bad), null);
});

function harness(jobs: DriveJob[], fail: string[] = []) {
  const log: string[] = [];
  let n = 0;
  const d: ArchiveDeps = {
    rootFolderId: "RAIZ",
    take: async () => jobs,
    token: async () => "tok",
    createFolder: async (_t, name, parent) => (log.push(`pasta ${name} em ${parent}`), fail.includes(name) ? null : `F${++n}`),
    createFile: async (_t, file, parent) => (log.push(`arquivo ${file.name.replace(/\d{14}/, "DATA")} em ${parent}`), fail.includes("arquivo") ? null : "A"),
    download: async (url) => (url.includes("ruim") ? null : { bytes: new Uint8Array([1]), mimetype: "image/png" }),
    saveLevel: async (b, p, id) => void log.push(`nivel ${p}=${id}`),
    saveCard: async (c, id) => void log.push(`card ${c}=${id}`),
    saveImage: async (id) => void log.push(`foto ${id} ok`),
  };
  return { d, log };
}

const job = (over: Partial<DriveJob> = {}): DriveJob => ({
  card_id: "c1",
  board_id: "b1",
  levels: [
    { path: "3º ano", name: "3º ano", folder_id: null },
    { path: "3º ano/Ciências", name: "Ciências", folder_id: null },
  ],
  name: "Erro 001 - 1ª unidade - p. 134",
  folder_id: null,
  txt: "texto",
  images: [{ id: "m1", url: "https://x/a.png" }],
  ...over,
});

test("arquiva: cria a hierarquia, o TXT e as fotos, confirmando cada passo", async () => {
  const { d, log } = harness([job()]);
  assert.equal(await archiveToDrive(d), 1);
  assert.deepEqual(log, [
    "pasta 3º ano em RAIZ",
    "nivel 3º ano=F1",
    "pasta Ciências em F1",
    "nivel 3º ano/Ciências=F2",
    "pasta Erro 001 - 1ª unidade - p. 134 em F2",
    "arquivo erro.txt em F3",
    "card c1=F3",
    "arquivo foto-DATA-1.png em F3",
    "foto m1 ok",
  ]);
});

test("arquiva: reaproveita pastas conhecidas e as criadas na mesma rodada", async () => {
  const known = job({ levels: [{ path: "3º ano", name: "3º ano", folder_id: "S" }, { path: "3º ano/Ciências", name: "Ciências", folder_id: "D" }], images: [] });
  const a = harness([known]);
  await archiveToDrive(a.d);
  assert.deepEqual(a.log.filter((l) => l.startsWith("pasta")), ["pasta Erro 001 - 1ª unidade - p. 134 em D"]);

  const b = harness([job({ images: [] }), job({ card_id: "c2", name: "Erro 002", images: [] })]);
  await archiveToDrive(b.d);
  assert.equal(b.log.filter((l) => l === "pasta 3º ano em RAIZ").length, 1);
  assert.equal(b.log.filter((l) => l === "pasta Ciências em F1").length, 1);
});

test("arquiva: card que já tem pasta recebe só a foto nova; falhas não confirmam", async () => {
  const more = job({ folder_id: "E", txt: null, levels: [{ path: "3º ano", name: "3º ano", folder_id: "S" }] });
  const a = harness([more]);
  await archiveToDrive(a.d);
  assert.deepEqual(a.log, ["arquivo foto-DATA-1.png em E", "foto m1 ok"]);

  const noFolder = harness([job()], ["Ciências"]);
  assert.equal(await archiveToDrive(noFolder.d), 0);
  assert.equal(noFolder.log.some((l) => l.startsWith("card")), false);

  const noFile = harness([job({ images: [{ id: "m1", url: "https://x/a.png" }, { id: "m2", url: "https://x/ruim.png" }] })], ["arquivo"]);
  await archiveToDrive(noFile.d);
  assert.equal(noFile.log.some((l) => l.startsWith("foto")), false);
});

test("arquiva: sem pendências não pede token; sem token não faz nada", async () => {
  let asked = 0;
  const empty = harness([]);
  empty.d.token = async () => (asked++, "tok");
  assert.equal(await archiveToDrive(empty.d), 0);
  assert.equal(asked, 0);
  const noToken = harness([job()]);
  noToken.d.token = async () => null;
  assert.equal(await archiveToDrive(noToken.d), 0);
  assert.deepEqual(noToken.log, []);
});
