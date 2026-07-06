// Insere UM card de exemplo (valida trigger do #number + caminho de leitura).
// Uso: node --env-file=.env infra/dev-add-card.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
try {
  const { rows: [b] } = await db.query(
    "select id, organization_id, segmento_id, ano_letivo_id from board order by created_at limit 1",
  );
  const { rows: [st] } = await db.query(
    "select id from stage where board_id=$1 order by position limit 1",
    [b.id],
  );
  const { rows: [mat] } = await db.query("select id, code from materia where code='TEX'");
  const { rows: [ser] } = await db.query("select id, code from serie where code='7A'");
  const { rows: [seg] } = await db.query("select code from segmento where id=$1", [b.segmento_id]);
  const { rows: [ano] } = await db.query("select year from ano_letivo where id=$1", [b.ano_letivo_id]);

  const code = `${mat.code}-${ser.code}-${seg.code}-1B-${ano.year}`;
  const { rows: [card] } = await db.query(
    `insert into card
       (organization_id, board_id, materia_id, serie_id, segmento_id,
        bimestre, ano_letivo_id, stage_id, code, title)
     values ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)
     returning number, code, title`,
    [b.organization_id, b.id, mat.id, ser.id, b.segmento_id, b.ano_letivo_id, st.id, code,
     "Produção de Texto — 7º ano — 1º bim"],
  );
  console.log("Card criado:", card);
} finally {
  await db.end();
}
