import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Banco da central de anamneses: schema `anamnese` no Postgres do Supabase.
//
// No Cloudflare Workers uma conexão aberta numa requisição NÃO pode ser usada
// em outra. Por isso o cliente é criado por requisição (chave = contexto da
// requisição do Cloudflare) e cada conexão serve uma vez só (maxUses: 1).
// A conexão vem do Hyperdrive (pool do Cloudflare na frente do Supabase); fora
// dele (scripts locais) usa ANAMNESE_DATABASE_URL.

type Env = { ANAMNESE_DB?: { connectionString: string } };

const porRequisicao = new WeakMap<object, PrismaClient>();
let semContexto: PrismaClient | null = null;

function connectionString(env: Env | undefined): string {
  const cs = env?.ANAMNESE_DB?.connectionString ?? process.env.ANAMNESE_DATABASE_URL;
  if (!cs) throw new Error("Banco da central de anamneses não configurado (binding ANAMNESE_DB ou ANAMNESE_DATABASE_URL).");
  return cs;
}

function criar(env: Env | undefined): PrismaClient {
  const adapter = new PrismaPg({ connectionString: connectionString(env), maxUses: 1 }, { schema: "anamnese" });
  return new PrismaClient({ adapter, log: ["error"] });
}

export function getPrisma(): PrismaClient {
  let ctx: { env: Env; ctx: object } | null = null;
  try {
    ctx = getCloudflareContext() as unknown as { env: Env; ctx: object };
  } catch {
    ctx = null; // script local / build
  }
  if (!ctx?.ctx) return (semContexto ??= criar(undefined));
  let client = porRequisicao.get(ctx.ctx);
  if (!client) {
    client = criar(ctx.env);
    porRequisicao.set(ctx.ctx, client);
  }
  return client;
}

/** Mesmo uso do código original (`prisma.appointment...`), resolvido por requisição. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
