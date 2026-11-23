/**
 * Google Drive, SÓ GRAVAÇÃO (SPEC-FASE2 §C, evidências).
 *
 * O Worker entra como uma conta de serviço do Google, que enxerga apenas a
 * pasta-raiz compartilhada com ela (num drive compartilhado). Daqui só saem
 * três coisas: criar pasta, criar arquivo e nada mais. Não lista, não lê, não
 * apaga e não move. Os ids das pastas e a numeração vivem no nosso banco.
 */

export interface DriveConfig {
  clientEmail: string;
  /** Chave privada da conta de serviço, em PEM (como vem no arquivo JSON do Google). */
  privateKey: string;
  rootFolderId: string;
}

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const utf8 = (text: string) => new TextEncoder().encode(text);

/** Monta e assina o pedido de acesso (JWT RS256) da conta de serviço. */
export async function signJwt(cfg: DriveConfig, nowSeconds: number): Promise<string> {
  const pem = cfg.privateKey.replace(/\\n/g, "\n");
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    utf8(
      JSON.stringify({
        iss: cfg.clientEmail,
        scope: "https://www.googleapis.com/auth/drive",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSeconds,
        exp: nowSeconds + 600,
      }),
    ),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
}

/** Troca o JWT por um token de acesso de curta duração. Null se o Google recusar. */
export async function accessToken(cfg: DriveConfig, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const jwt = await signJwt(cfg, Math.floor(Date.now() / 1000));
    const res = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("drive: login HTTP", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { access_token?: unknown };
    return typeof data.access_token === "string" ? data.access_token : null;
  } catch (e) {
    console.error("drive: login", e instanceof Error ? e.name : "erro");
    return null;
  }
}

async function created(res: Response, what: string): Promise<string | null> {
  if (!res.ok) {
    console.error(`drive: ${what} HTTP`, res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const data = (await res.json()) as { id?: unknown };
  return typeof data.id === "string" ? data.id : null;
}

/** Cria uma pasta dentro de `parentId`. Devolve o id, ou null. */
export async function createFolder(token: string, name: string, parentId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
      signal: AbortSignal.timeout(15_000),
    });
    return await created(res, "pasta");
  } catch (e) {
    console.error("drive: pasta", e instanceof Error ? e.name : "erro");
    return null;
  }
}

/** Cria um arquivo dentro de `parentId`. Devolve o id, ou null. */
export async function createFile(
  token: string,
  file: { name: string; mimetype: string; bytes: Uint8Array },
  parentId: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const boundary = `ecco${crypto.randomUUID().replace(/-/g, "")}`;
    const head = utf8(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: file.name, parents: [parentId] }) +
        `\r\n--${boundary}\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
    );
    const tail = utf8(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + file.bytes.length + tail.length);
    body.set(head, 0);
    body.set(file.bytes, head.length);
    body.set(tail, head.length + file.bytes.length);
    const res = await fetcher(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: body as BodyInit,
        signal: AbortSignal.timeout(25_000),
      },
    );
    return await created(res, "arquivo");
  } catch (e) {
    console.error("drive: arquivo", e instanceof Error ? e.name : "erro");
    return null;
  }
}

export interface DriveJob {
  card_id: string;
  board_id: string;
  levels: { path: string; name: string; folder_id: string | null }[];
  name: string;
  folder_id: string | null;
  txt: string | null;
  images: { id: string; url: string }[];
}

export interface ArchiveDeps {
  rootFolderId: string;
  take(): Promise<DriveJob[] | null>;
  token(): Promise<string | null>;
  createFolder(token: string, name: string, parentId: string): Promise<string | null>;
  createFile(token: string, file: { name: string; mimetype: string; bytes: Uint8Array }, parentId: string): Promise<string | null>;
  /** Baixa a foto já guardada no armazenamento do sistema. */
  download(url: string): Promise<{ bytes: Uint8Array; mimetype: string } | null>;
  saveLevel(boardId: string, path: string, folderId: string): Promise<void>;
  saveCard(cardId: string, folderId: string): Promise<void>;
  saveImage(mediaId: string): Promise<void>;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Rotina de cada minuto: grava no Drive o que estiver pendente. Cada passo que
 * dá certo é confirmado no banco na hora, então uma falha no meio não repete o
 * que já foi feito: a próxima rodada continua de onde parou.
 */
export async function archiveToDrive(deps: ArchiveDeps): Promise<number> {
  const jobs = (await deps.take()) ?? [];
  if (jobs.length === 0) return 0;
  const token = await deps.token();
  if (!token) return 0;
  // Pastas de nível criadas nesta rodada (dois cards novos do mesmo livro).
  const fresh = new Map<string, string>();
  let done = 0;

  for (const job of jobs) {
    let parent: string | null = deps.rootFolderId;
    for (const level of job.levels) {
      const key = `${job.board_id}|${level.path}`;
      let id: string | null = level.folder_id ?? fresh.get(key) ?? null;
      if (!id) {
        id = await deps.createFolder(token, level.name, parent);
        if (!id) {
          parent = null;
          break;
        }
        fresh.set(key, id);
        await deps.saveLevel(job.board_id, level.path, id);
      }
      parent = id;
    }
    if (!parent) continue;

    let folder = job.folder_id;
    if (!folder) {
      folder = await deps.createFolder(token, job.name, parent);
      if (!folder) continue;
      if (job.txt) {
        // BOM: o Bloco de Notas do Windows abre com os acentos certos.
        const txt = new TextEncoder().encode(`﻿${job.txt}`);
        await deps.createFile(token, { name: "erro.txt", mimetype: "text/plain; charset=utf-8", bytes: txt }, folder);
      }
      await deps.saveCard(job.card_id, folder);
    }

    let n = 0;
    for (const image of job.images) {
      const file = await deps.download(image.url);
      if (!file) continue;
      n++;
      const name = `foto-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${n}.${EXT[file.mimetype] ?? "jpg"}`;
      if (await deps.createFile(token, { name, mimetype: file.mimetype, bytes: file.bytes }, folder)) {
        await deps.saveImage(image.id);
      }
    }
    done++;
  }
  return done;
}
