-- Dev: gate de exemplo — mover PARA "Revisão de área" exige checklist completo.
-- Idempotente. node --env-file=.env infra/run-sql.mjs dev-gate.sql
insert into workflow_rule
  (organization_id, board_id, from_stage_id, to_stage_id, requirement, enforcement, is_active)
select b.organization_id, b.id, null, s.id, 'checklist_complete', 'block', true
from board b
join stage s on s.board_id = b.id and s.name = 'Revisão de área'
where not exists (
  select 1 from workflow_rule w
  join stage s2 on s2.id = w.to_stage_id and s2.name = 'Revisão de área'
)
order by b.created_at
limit 1;
