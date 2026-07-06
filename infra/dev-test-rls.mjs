// Testa as políticas RLS: externo só vê cards atribuídos; interno vê tudo.
// Roda numa transação REVERTIDA (não altera dados reais). Simula o contexto
// authenticated via request.jwt.claims (como o Supabase faz com o token).
// node --env-file=.env infra/dev-test-rls.mjs
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: [u] } = await c.query(
  "select id, email from app_user order by created_at limit 1",
);
if (!u) {
  console.log("Sem app_user — faça login no app primeiro (provisiona o usuário).");
  await c.end();
  process.exit(0);
}

async function visibleCardsAs(external) {
  await c.query("BEGIN");
  try {
    await c.query("update app_user set is_internal = $2 where id = $1", [u.id, !external]);
    await c.query("delete from assignment where user_id = $1", [u.id]);
    if (external) {
      await c.query(
        `insert into assignment (organization_id, card_id, user_id, stage_id)
         select organization_id, id, $1, stage_id from card where number = 1`,
        [u.id],
      );
    }
    const total = (await c.query("select count(*)::int n from card")).rows[0].n;
    await c.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role','authenticated')::text, true)",
      [u.id],
    );
    await c.query("set local role authenticated");
    const visible = (await c.query("select count(*)::int n from card")).rows[0].n;
    await c.query("reset role");
    return { total, visible };
  } finally {
    await c.query("ROLLBACK");
  }
}

try {
  const ext = await visibleCardsAs(true);
  const int = await visibleCardsAs(false);
  console.log(`usuário de teste: ${u.email}`);
  console.log(`EXTERNO (1 card atribuído): vê ${ext.visible} de ${ext.total}  → esperado 1`);
  console.log(`INTERNO:                    vê ${int.visible} de ${int.total}  → esperado ${int.total}`);
} catch (e) {
  console.error("FALHA:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
