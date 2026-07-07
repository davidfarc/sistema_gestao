// Verifica a migration 0007 (read-only): colunas de DM na channel, a função
// conversation_list e as tabelas publicadas no Realtime.
// Uso: node --env-file=.env infra/dev-verify-dm.mjs
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  // 1) Colunas kind / dm_key
  const cols = (
    await c.query(
      `select column_name from information_schema.columns
       where table_name='channel' and column_name in ('kind','dm_key')`,
    )
  ).rows.map((r) => r.column_name);
  console.log(
    cols.includes("kind") && cols.includes("dm_key")
      ? "✅ channel.kind + dm_key presentes"
      : `❌ colunas faltando (achei: ${cols.join(", ") || "nenhuma"})`,
  );

  // 2) Publicação no Realtime
  const pub = (
    await c.query(
      `select tablename from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename in ('message','channel','channel_member')`,
    )
  ).rows.map((r) => r.tablename);
  console.log(
    ["message", "channel", "channel_member"].every((t) => pub.includes(t))
      ? "✅ Realtime publica message + channel + channel_member"
      : `⚠️ Realtime só publica: ${pub.join(", ") || "nenhuma"}`,
  );

  // 3) Função conversation_list responde
  const { rows: users } = await c.query(
    "select id, email from app_user order by created_at limit 1",
  );
  if (!users[0]) {
    console.log("⚠️  Sem app_user — smoke test da RPC pulado (faça login no app).");
  } else {
    const me = users[0];
    const { rows } = await c.query("select * from conversation_list($1)", [me.id]);
    console.log(`✅ conversation_list OK — ${rows.length} conversa(s) p/ ${me.email}`);
    for (const r of rows.slice(0, 5)) {
      const label = r.kind === "dm" ? r.other_name ?? r.other_email : r.name;
      console.log(
        `   • [${r.kind}] ${label} — última: ${r.last_body ? JSON.stringify(String(r.last_body).slice(0, 30)) : "—"} — não-lidas: ${r.unread}`,
      );
    }
  }
} catch (e) {
  console.error("FALHA:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
