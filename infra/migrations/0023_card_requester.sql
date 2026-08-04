-- "Solicitante" como propriedade NATIVA do card, ao lado de "Responsável".
--
-- Responsável já é nativo (assignment com stage_id nulo); solicitante segue a
-- mesma lógica de primeira classe em vez de campo customizado — assim vale em
-- todos os pipelines por padrão, sem precisar criar a propriedade em cada um.
--
-- Preenchido com o autor na criação do card; pode ser trocado depois.
alter table card
  add column if not exists requester_id uuid references app_user(id);

create index if not exists card_requester_idx on card (requester_id);

-- Backfill: quem criou o card (primeiro registro de atividade card_created).
update card c
set requester_id = a.actor_id
from activity a
where a.card_id = c.id
  and a.kind = 'card_created'
  and c.requester_id is null;
