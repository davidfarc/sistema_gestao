// Importa o estado do módulo Vila do Firebase RTDB (projeto eccoprime-salas)
// para o Supabase, e salva um BACKUP local antes de gravar.
//
// Uso: node --env-file=apps/web/.env.local infra/salas-import.mjs
//
// O RTDB é público (regras abertas) — a leitura é só um GET, sem credencial.
// Só LÊ do Firebase; nunca escreve lá.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

// Pasta de backup relativa a ESTE arquivo — funciona de qualquer cwd.
const backupDir = join(dirname(fileURLToPath(import.meta.url)), "backups");

const RTDB = "https://eccoprime-salas-default-rtdb.firebaseio.com";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// 1. Lê o estado atual + os alertas de busca ativa.
console.log("Lendo do Firebase…");
const [stateRes, alertsRes] = await Promise.all([
  fetch(`${RTDB}/escolasim_state.json`),
  fetch(`${RTDB}/busca_ativa_alerts.json`),
]);
if (!stateRes.ok) {
  console.error(`Falha ao ler o RTDB: ${stateRes.status}`);
  process.exit(1);
}
const state = await stateRes.json();
const alerts = alertsRes.ok ? await alertsRes.json() : null;

// 2. BACKUP antes de qualquer escrita (exigência do plano original).
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(backupDir, { recursive: true });
const file = join(backupDir, `salas-rtdb-${stamp}.json`);
writeFileSync(file, JSON.stringify({ escolasim_state: state, busca_ativa_alerts: alerts }, null, 2));
console.log(`Backup salvo em ${file}`);

// 3. Resumo do que veio (confere antes de gravar).
const count = (v) => (Array.isArray(v) ? v.filter(Boolean).length : Object.keys(v ?? {}).length);
console.log(
  `  salas=${count(state?.rooms)} alunos=${count(state?.students)} ` +
    `equipe=${count(state?.adults)} cargos=${count(state?.staffTypes)} ` +
    `dias de rotina=${count(state?.dailyRoutine)}`,
);

// 4. Grava no Supabase (uma linha por organização).
const { data: org } = await db
  .from("organization")
  .select("id")
  .order("created_at")
  .limit(1)
  .single();
if (!org) {
  console.error("Nenhuma organização encontrada.");
  process.exit(1);
}

const { error } = await db
  .from("sala_state")
  .upsert(
    { organization_id: org.id, state: state ?? {}, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" },
  );
if (error) {
  console.error("Falha ao gravar no Supabase:", error.message);
  process.exit(1);
}
console.log("Estado importado para o Supabase.");
