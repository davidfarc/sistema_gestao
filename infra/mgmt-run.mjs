// Roda um arquivo SQL via Supabase Management API (sem depender do pooler).
// Uso: node infra/mgmt-run.mjs <arquivo.sql>
// Requer env: SUPABASE_ACCESS_TOKEN (personal access token) e, opcional,
// SUPABASE_PROJECT_REF (default njdocgzzuhhlaweqqnrq).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF || "njdocgzzuhhlaweqqnrq";
const rel = process.argv[2];

if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN ausente.");
  process.exit(1);
}
if (!rel) {
  console.error("Uso: node infra/mgmt-run.mjs <arquivo.sql>");
  process.exit(1);
}

const sql = readFileSync(join(here, rel), "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (res.ok) {
  console.log(`✅ ${rel} aplicado (HTTP ${res.status}). Resposta: ${text.slice(0, 200)}`);
} else {
  console.error(`❌ HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exitCode = 1;
}
