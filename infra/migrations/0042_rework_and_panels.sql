-- ============================================================================
-- 0042_rework_and_panels.sql — Emendas e painel por pipeline (SPEC-FASE2 §E.8)
--
-- 1. `stage.counts_rework`: etapa de "emenda" (devolução). Cada vez que um card
--    ENTRA numa etapa marcada assim, o contador do card sobe.
-- 2. `card.rework_count`: quantas vezes o card foi devolvido. Mantido por
--    gatilho no banco, então vale para qualquer caminho que mude a etapa
--    (mover, enviar para outro pipeline).
-- 3. `board.own_panel`: o pipeline ganha um painel próprio em "Painéis".
--
-- Só cria colunas e um gatilho. Idempotente.
-- ============================================================================

alter table stage add column if not exists counts_rework boolean not null default false;
alter table card  add column if not exists rework_count  integer not null default 0;
alter table board add column if not exists own_panel     boolean not null default false;

create or replace function public.card_count_rework()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage_id is distinct from old.stage_id
     and exists (select 1 from stage s where s.id = new.stage_id and s.counts_rework) then
    new.rework_count := coalesce(old.rework_count, 0) + 1;
  end if;
  return new;
end$$;

revoke all on function public.card_count_rework() from public, anon, authenticated;

drop trigger if exists card_count_rework on card;
create trigger card_count_rework
  before update of stage_id on card
  for each row execute function public.card_count_rework();
