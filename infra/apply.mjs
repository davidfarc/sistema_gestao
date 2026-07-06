// Aplica as migrations/seed no Postgres do Supabase.
// Uso: node --env-file=.env infra/apply.mjs
//
// Cada arquivo é enviado como uma única query (protocolo simples) → roda numa
// transação implícita: se algo falhar, faz rollback e nada fica pela metade,
// então dá para corrigir e reaplicar.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "migrations/0001_schema.sql",
  "migrations/0002_rls.sql",
  "seeds/0003_seed.sql",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ausente (rodar com: node --env-file=.env infra/apply.mjs)");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }, // Supabase exige SSL
});

await client.connect();
try {
  for (const file of FILES) {
    const sql = readFileSync(join(here, file), "utf8");
    process.stdout.write(`== ${file} ... `);
    await client.query(sql);
    process.stdout.write("OK\n");
  }
  console.log("\n✅ Migrations + seed aplicados com sucesso.");
} catch (err) {
  console.error(`\n❌ FALHA: ${err.message}`);
  if (err.position) console.error(`   (posição ${err.position})`);
  process.exitCode = 1;
} finally {
  await client.end();
}
