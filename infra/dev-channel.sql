-- Dev: canal "geral" com o owner como membro + uma mensagem de boas-vindas.
with u as (select id, organization_id from app_user order by created_at limit 1),
ch as (
  insert into channel (organization_id, name)
  select organization_id, 'geral' from u
  where not exists (select 1 from channel where name = 'geral')
  returning id, organization_id
),
mem as (
  insert into channel_member (channel_id, user_id)
  select ch.id, u.id from ch, u
  on conflict do nothing
  returning channel_id
)
insert into message (organization_id, channel_id, author_id, body)
select ch.organization_id, ch.id, u.id, 'Bem-vindo ao canal geral!'
from ch, u;
