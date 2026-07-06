// Testa o CardService.move real contra o banco (porta via pg espelha o adaptador).
// node --env-file=.env infra/dev-test-move.mjs
import pg from "pg";

import { CardService } from "../packages/core/src/index.ts";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: [card1] } = await c.query("select id, board_id, stage_id from card where number = 1");
const { rows: [rev] } = await c.query(
  "select id from stage where name = 'Revisão de área' and board_id = $1",
  [card1.board_id],
);

const port = {
  async getCard(id) {
    const { rows: [r] } = await c.query("select board_id, stage_id from card where id = $1", [id]);
    return r ? { boardId: r.board_id, stageId: r.stage_id } : null;
  },
  async stageInBoard(sid, bid) {
    const { rows } = await c.query("select 1 from stage where id = $1 and board_id = $2", [sid, bid]);
    return rows.length > 0;
  },
  async listRules(bid, from, to) {
    const { rows } = await c.query(
      "select * from workflow_rule where board_id = $1 and to_stage_id = $2 and is_active",
      [bid, to],
    );
    return rows
      .filter((r) => r.from_stage_id === null || r.from_stage_id === from)
      .map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        boardId: r.board_id,
        fromStageId: r.from_stage_id,
        toStageId: r.to_stage_id,
        requirement: r.requirement,
        requirementConfig: r.requirement_config || {},
        enforcement: r.enforcement,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: r.archived_at,
      }));
  },
  async getFacts(id) {
    const { rows: lists } = await c.query("select id from checklist where card_id = $1", [id]);
    let checklistComplete = false;
    if (lists.length) {
      const { rows: items } = await c.query(
        "select done from checklist_item where checklist_id = any($1)",
        [lists.map((l) => l.id)],
      );
      checklistComplete = items.length > 0 && items.every((i) => i.done);
    }
    return {
      checklistComplete,
      hasAttachment: false,
      filledFieldIds: new Set(),
      hasConcludedEmenda: false,
      hasApproval: false,
      actorHasRole: () => false,
    };
  },
  async applyMove() {
    throw new Error("applyMove NÃO deveria ser chamado — o gate deve bloquear.");
  },
};

const actor = {
  userId: "sys",
  organizationId: "sys",
  isInternal: true,
  permissions: new Set(["card:move"]),
  teamIds: [],
};

const svc = new CardService(port, () => "2027-01-01T00:00:00.000Z");
try {
  await svc.move(actor, card1.id, rev.id);
  console.log("❌ NÃO bloqueou (inesperado)");
} catch (e) {
  console.log(`✅ Bloqueado: ${e.constructor.name} — "${e.message}"`);
  console.log("   violations:", JSON.stringify(e.details));
}
await c.end();
