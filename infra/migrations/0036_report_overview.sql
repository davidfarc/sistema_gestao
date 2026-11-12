-- ============================================================================
-- 0036_report_overview.sql — Resumo por pipeline (Painel /painel e, depois, MCP)
--
-- `report_pipeline_overview(p_stalled_days)`: uma linha por pipeline que a
-- pessoa enxerga, com cards em aberto, atrasados, parados, concluídos e criados
-- nos últimos 7 dias, "meus cards" e a contagem por etapa.
--
-- SECURITY INVOKER: roda com o RLS de quem chama (board_read / card_read /
-- stage_read, migration 0002). A função não amplia o que a pessoa já vê.
--
-- Definições:
--   em aberto  = card não arquivado numa etapa de categoria diferente de `done`
--   atrasado   = em aberto com prazo anterior a hoje (dia de São Paulo)
--   parado     = em aberto e na mesma etapa há mais de p_stalled_days dias
--   meu        = em aberto e com a pessoa como responsável
--
-- Só cria função e permissão; não altera tabelas nem dados. Idempotente.
-- ============================================================================

create or replace function public.report_pipeline_overview(p_stalled_days integer default 7)
returns table (
  board_id       uuid,
  board_name     text,
  open_cards     integer,
  overdue        integer,
  stalled        integer,
  completed_week integer,
  created_week   integer,
  mine           integer,
  stages         jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      (now() at time zone 'America/Sao_Paulo')::date           as today,
      now() - make_interval(days => greatest(p_stalled_days, 1)) as stalled_before,
      now() - interval '7 days'                                 as week_start
  ),
  c as (
    select
      k.id,
      k.board_id,
      k.stage_id,
      k.created_at,
      k.completed_at,
      s.category <> 'done'                                      as is_open,
      k.due_date is not null and k.due_date < p.today           as past_due,
      k.stage_entered_at < p.stalled_before                     as is_stalled,
      exists (
        select 1 from assignment a
        where a.card_id = k.id and a.stage_id is null
          and a.user_id = auth.uid() and a.archived_at is null
      )                                                         as is_mine
    from card k
    join stage s on s.id = k.stage_id
    cross join params p
    where k.archived_at is null
  ),
  per_board as (
    select
      c.board_id,
      count(*) filter (where c.is_open)                         as open_cards,
      count(*) filter (where c.is_open and c.past_due)          as overdue,
      count(*) filter (where c.is_open and c.is_stalled)        as stalled,
      count(*) filter (where c.completed_at >= p.week_start)    as completed_week,
      count(*) filter (where c.created_at >= p.week_start)      as created_week,
      count(*) filter (where c.is_open and c.is_mine)           as mine
    from c cross join params p
    group by c.board_id
  ),
  per_stage as (
    select
      s.board_id,
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'category', s.category,
          'wipLimit', s.wip_limit,
          'cards', (select count(*) from c where c.stage_id = s.id)
        )
        order by s.position, s.name
      ) as stages
    from stage s
    where s.archived_at is null
    group by s.board_id
  )
  select
    b.id,
    b.name,
    coalesce(pb.open_cards, 0)::integer,
    coalesce(pb.overdue, 0)::integer,
    coalesce(pb.stalled, 0)::integer,
    coalesce(pb.completed_week, 0)::integer,
    coalesce(pb.created_week, 0)::integer,
    coalesce(pb.mine, 0)::integer,
    coalesce(ps.stages, '[]'::jsonb)
  from board b
  left join per_board pb on pb.board_id = b.id
  left join per_stage ps on ps.board_id = b.id
  where b.archived_at is null
  order by b.name
$$;

revoke all on function public.report_pipeline_overview(integer) from public;
revoke all on function public.report_pipeline_overview(integer) from anon;
grant execute on function public.report_pipeline_overview(integer) to authenticated;
