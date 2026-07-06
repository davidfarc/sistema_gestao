// Verificação ad-hoc do estado (gate + checklist do card #1).
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  const rules = await c.query(
    "select w.requirement, w.enforcement, s.name as para from workflow_rule w join stage s on s.id = w.to_stage_id where w.is_active",
  );
  console.log("Gates ativos:");
  console.table(rules.rows);

  const ck = await c.query(
    `select cl.name,
            count(ci.*) filter (where ci.done) as feitos,
            count(ci.*) as total
     from card cd
     join checklist cl on cl.card_id = cd.id
     left join checklist_item ci on ci.checklist_id = cl.id
     where cd.number = 1
     group by cl.name`,
  );
  console.log("Checklists do card #1:");
  console.table(ck.rows);
} finally {
  await c.end();
}
