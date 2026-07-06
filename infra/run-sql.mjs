// Aplica UM arquivo SQL avulso (migration incremental).
// Uso: node --env-file=.env infra/run-sql.mjs migrations/0004_card_optional_taxonomy.sql
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const rel = process.argv[2];
if (!rel) {
  console.error("Uso: node --env-file=.env infra/run-sql.mjs <arquivo.sql>");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const sql = readFileSync(join(here, rel), "utf8");
  await client.query(sql);
  console.log(`✅ ${rel} aplicado.`);
} catch (err) {
  console.error(`❌ FALHA: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
