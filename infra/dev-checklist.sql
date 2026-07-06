-- Dev: checklist de exemplo no card #1 (valida schema checklist/checklist_item).
-- node --env-file=.env infra/run-sql.mjs dev-checklist.sql
with c as (
  select id, organization_id from card order by number limit 1
),
ins as (
  insert into checklist (organization_id, card_id, name, position)
  select organization_id, id, 'Revisão', 0 from c
  returning id
)
insert into checklist_item (checklist_id, text, done, position)
select ins.id, v.text, v.done, v.pos
from ins,
  (values
    ('Revisão interna', true, 0),
    ('Enviado para o autor (reescrita)', false, 1),
    ('Enviado para diagramação', false, 2)
  ) as v(text, done, pos);
