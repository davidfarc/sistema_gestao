// Verificação rápida do que foi semeado. Uso: node --env-file=.env infra/check.mjs
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const counts = await client.query(`
    select
      (select count(*) from organization) as orgs,
      (select count(*) from team) as equipes,
      (select count(*) from role) as papeis,
      (select count(*) from segmento) as segmentos,
      (select count(*) from materia) as materias,
      (select count(*) from serie) as series,
      (select count(*) from board) as boards,
      (select count(*) from stage) as etapas
  `);
  console.table(counts.rows[0]);

  const stages = await client.query(
    `select position, name, category from stage order by position`,
  );
  console.log("\nEtapas do quadro:");
  for (const s of stages.rows) {
    console.log(`  ${String(s.position).padStart(2)}  ${s.name}  [${s.category}]`);
  }
} finally {
  await client.end();
}
