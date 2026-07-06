-- Dev: cria a propriedade "Prioridade" (status, mostra no card) e seta o card #1.
with b as (select id, organization_id from board order by created_at limit 1),
fd as (
  insert into field_definition
    (organization_id, board_id, name, type, config, show_on_card_face, is_filterable, position)
  select b.organization_id, b.id, 'Prioridade', 'status',
    '{"options":[
       {"id":"opt0","label":"Baixa","color":"#047857"},
       {"id":"opt1","label":"Média","color":"#b45309"},
       {"id":"opt2","label":"Alta","color":"#ba1a1a"}
     ]}'::jsonb,
    true, true, 0
  from b
  where not exists (
    select 1 from field_definition fx
    where fx.board_id = b.id and fx.name = 'Prioridade'
  )
  returning id, organization_id
)
insert into field_value (field_definition_id, card_id, organization_id, value_text)
select fd.id, c.id, fd.organization_id, 'opt2'
from fd, card c
where c.number = 1
on conflict (field_definition_id, card_id) do update set value_text = excluded.value_text;
