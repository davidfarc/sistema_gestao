-- ============================================================================
-- 0035_board_realtime_and_completion.sql — Quadro em tempo real + data de conclusão
--
-- 1. Publica `card` e `stage` no Realtime, para o Kanban atualizar sem recarregar.
--    O RLS (card_read / stage_read, migration 0002) continua escopando as linhas.
-- 2. `card.completed_at`: preenchido por trigger quando o card entra numa etapa de
--    categoria `done`, e limpo quando sai. Base dos relatórios de produtividade.
--
-- Idempotente.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card'
  ) then
    alter publication supabase_realtime add table card;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stage'
  ) then
    alter publication supabase_realtime add table stage;
  end if;
end$$;

alter table card add column if not exists completed_at timestamptz;

create or replace function public.card_set_completed_at()
returns trigger
language plpgsql
as $$
declare
  cat text;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  select category into cat from stage where id = new.stage_id;
  if cat = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end$$;

drop trigger if exists card_completed_at on card;
create trigger card_completed_at
  before insert or update of stage_id on card
  for each row execute function public.card_set_completed_at();

-- Cards que já estão numa etapa concluída: usa a data em que entraram nela.
update card c
   set completed_at = c.stage_entered_at
  from stage s
 where s.id = c.stage_id
   and s.category = 'done'
   and c.completed_at is null;

create index if not exists card_completed_idx on card (board_id, completed_at)
  where completed_at is not null;
