// Extrai UMA variável do apps/web/.env.local e grava o valor puro (UTF-8 sem
// BOM, sem newline) num arquivo — para alimentar `vercel env add` via redirect
// do cmd, evitando o BOM que o PowerShell injeta ao encanar para stdin.
// Uso: node infra/env-to-file.mjs <NOME> <arquivo_saida>
import { readFileSync, writeFileSync } from "node:fs";

const [name, out] = process.argv.slice(2);
if (!name || !out) {
  console.error("Uso: node infra/env-to-file.mjs <NOME> <arquivo_saida>");
  process.exit(1);
}
const raw = readFileSync("apps/web/.env.local", "utf8");
const line = raw.split(/\r?\n/).find((l) => l.startsWith(name + "="));
if (!line) {
  console.error("Não encontrei " + name + " em apps/web/.env.local");
  process.exit(1);
}
let v = line.slice(name.length + 1).trim();
if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
v = v.replace(/[﻿​‎‏]/g, ""); // remove BOM/zero-width
writeFileSync(out, v); // sem BOM, sem newline
console.log(name + " → " + out + " (len " + v.length + ")");
