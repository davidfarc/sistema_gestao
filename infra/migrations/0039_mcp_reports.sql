-- ============================================================================
-- 0039_mcp_reports.sql — Relatórios para assistentes de IA (MCP, SPEC-FASE2 §D)
--
-- 1. Permissão `report:read` para Gestor Master e Gestor (ajustável na tela de
--    papéis).
-- 2. `api_token`: tokens pessoais. Guarda só o HASH (sha-256) do token; o valor
--    é mostrado uma única vez, na criação.
-- 3. `api_token_call`: registro de cada chamada (quem, ferramenta, quando) e
--    base do limite de 60 chamadas por minuto por token.
-- 4. Funções `report_*`: as contas das 7 ferramentas. Todas filtram
--    explicitamente pelo alcance de quem pergunta (`can_see_board` /
--    `can_see_card`, os mesmos do RLS), então valem tanto chamadas pela tela
--    (com RLS) quanto pelo `mcp_call` (que roda como dono e ignora o RLS).
-- 5. `mcp_call(hash, ferramenta, argumentos)`: a ÚNICA porta do Worker MCP.
--    Valida o token, aplica o limite, assume a identidade do dono do token
--    (só para leitura, só nesta transação), confere `report:read`, executa e
--    registra. O Worker não guarda chave secreta: a credencial é o token.
--
-- Fora do alcance, de propósito: Gestão de Vila e Novos alunos (dados de
-- alunos e famílias). Nenhuma função aqui lê `sala_state` nem o schema anamnese.
--
-- Só cria tabelas e funções novas e concede uma permissão. Idempotente.
-- ============================================================================

-- ── 1. Permissão ────────────────────────────────────────────────────────────

update role
   set permissions = permissions || '["report:read"]'::jsonb
 where slug in ('master', 'gestor')
   and archived_at is null
   and not permissions @> '["report:read"]'::jsonb;

-- ── 2 e 3. Tokens e registro de chamadas ────────────────────────────────────

create table if not exists api_token (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  user_id         uuid not null references app_user(id) on delete cascade,
  name            text not null,
  token_hash      text not null unique,       -- sha-256 (hex) do token
  token_prefix    text not null,              -- começo do token, só para a pessoa reconhecer
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz
);
create index if not exists api_token_user_idx on api_token (user_id);

create table if not exists api_token_call (
  id         bigint generated always as identity primary key,
  token_id   uuid not null references api_token(id) on delete cascade,
  tool       text not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists api_token_call_token_idx on api_token_call (token_id, created_at desc);

alter table api_token enable row level security;
alter table api_token_call enable row level security;

-- Cada pessoa lê só os próprios tokens (sem o hash servir para nada: não é o
-- token). Escrita é só do servidor.
drop policy if exists api_token_read on api_token;
create policy api_token_read on api_token for select to authenticated
  using (user_id = auth.uid());

drop policy if exists api_token_call_read on api_token_call;
create policy api_token_call_read on api_token_call for select to authenticated
  using (exists (select 1 from api_token t where t.id = api_token_call.token_id and t.user_id = auth.uid()));

revoke all on api_token, api_token_call from anon;
revoke insert, update, delete on api_token, api_token_call from authenticated;

-- ── 4. Relatórios ───────────────────────────────────────────────────────────

-- Nome de exibição de uma pessoa (nunca o e-mail, salvo se não houver nome).
create or replace function public.report_user_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(u.name, ''), u.email) from app_user u where u.id = p_user
$$;

-- Cards que QUEM PERGUNTA enxerga, já com pipeline, etapa e responsável.
-- É a base de todos os relatórios: o alcance é decidido aqui, uma vez.
create or replace function public.report_scope_cards()
returns table (
  id uuid, board_id uuid, board_name text, number bigint, title text,
  stage_id uuid, stage_name text, stage_category text, stage_position integer,
  due_date date, stage_entered_at timestamptz, completed_at timestamptz,
  created_at timestamptz, requester_id uuid, responsible_id uuid
)
language sql stable set search_path = public as $$
  -- Os pipelines visíveis são resolvidos uma vez, e não card a card.
  with vb as materialized (
    select b.id, b.name from board b
    where b.archived_at is null and public.can_see_board(b.id)
  ),
  internal as materialized (select public.is_internal() as yes)
  select
    c.id, vb.id, vb.name, c.number, c.title,
    s.id, s.name, s.category, s.position,
    c.due_date, c.stage_entered_at, c.completed_at, c.created_at, c.requester_id,
    (select a.user_id from assignment a
      where a.card_id = c.id and a.stage_id is null and a.archived_at is null
      limit 1)
  from card c
  join vb on vb.id = c.board_id
  join stage s on s.id = c.stage_id
  cross join internal i
  where c.archived_at is null
    and (i.yes or public.can_see_card(c.id))
$$;

-- Permanências em etapa: uma linha por vez que um card SAIU de uma etapa.
-- Movimentações novas trazem a etapa de origem e os segundos no histórico;
-- nas antigas, os dois são reconstruídos pela sequência de `card_moved`.
create or replace function public.report_stage_stays()
returns table (card_id uuid, board_id uuid, stage_id uuid, seconds numeric, left_at timestamptz, actor_id uuid)
language sql stable set search_path = public as $$
  with moves as (
    select
      a.card_id, sc.board_id, a.actor_id, a.created_at,
      nullif(a.payload->>'fromStageId', '')::uuid   as from_stage,
      nullif(a.payload->>'toStageId', '')::uuid     as to_stage,
      nullif(a.payload->>'secondsInStage', '')::numeric as secs,
      lag(nullif(a.payload->>'toStageId', '')::uuid) over w as prev_to,
      lag(a.created_at) over w                      as prev_at,
      sc.created_at                                 as card_created
    from activity a
    join public.report_scope_cards() sc on sc.id = a.card_id
    where a.kind = 'card_moved'
    window w as (partition by a.card_id order by a.created_at)
  )
  select
    m.card_id, m.board_id,
    coalesce(m.from_stage, m.prev_to),
    coalesce(m.secs, extract(epoch from m.created_at - coalesce(m.prev_at, m.card_created))),
    m.created_at, m.actor_id
  from moves m
  where coalesce(m.from_stage, m.prev_to) is not null
$$;

-- listar_pipelines
create or replace function public.report_pipelines()
returns jsonb language sql stable set search_path = public as $$
  with c as materialized (select * from public.report_scope_cards()),
  per_stage as (select stage_id, count(*) as n from c group by stage_id),
  per_board as (select board_id, count(*) filter (where stage_category <> 'done') as n from c group by board_id)
  select coalesce(jsonb_agg(p order by p->>'nome'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', b.id,
      'nome', b.name,
      'cards_em_aberto', coalesce((select n from per_board pb where pb.board_id = b.id), 0),
      'etapas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nome', s.name, 'categoria', s.category, 'limite', s.wip_limit,
                 'cards', coalesce((select n from per_stage ps where ps.stage_id = s.id), 0))
               order by s.position, s.name)
        from stage s where s.board_id = b.id and s.archived_at is null), '[]'::jsonb)
    ) as p
    from board b
    where b.archived_at is null and public.can_see_board(b.id)
  ) x
$$;

-- resumo_pipeline
create or replace function public.report_pipeline_summary(
  p_board uuid, p_from timestamptz, p_to timestamptz, p_stalled_days integer default 7
)
returns jsonb language sql stable set search_path = public as $$
  with c as (select * from public.report_scope_cards() where board_id = p_board),
  stays as (
    select stage_id, avg(seconds) as avg_s, count(*) as n
    from public.report_stage_stays()
    where board_id = p_board and left_at >= p_from and left_at < p_to
    group by stage_id
  )
  select jsonb_build_object(
    'pipeline', (select name from board where id = p_board),
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'em_aberto', (select count(*) from c where stage_category <> 'done'),
    'atrasados', (select count(*) from c where stage_category <> 'done'
                   and due_date < (now() at time zone 'America/Sao_Paulo')::date),
    'parados', (select count(*) from c where stage_category <> 'done'
                 and stage_entered_at < now() - make_interval(days => greatest(p_stalled_days, 1))),
    'parado_significa', format('mais de %s dias na mesma etapa', greatest(p_stalled_days, 1)),
    'criados_no_periodo', (select count(*) from c where created_at >= p_from and created_at < p_to),
    'concluidos_no_periodo', (select count(*) from c where completed_at >= p_from and completed_at < p_to),
    'tempo_medio_do_inicio_ao_fim_dias', (
      select round((avg(extract(epoch from completed_at - created_at)) / 86400)::numeric, 1)
      from c where completed_at >= p_from and completed_at < p_to),
    'etapas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'etapa', s.name,
               'categoria', s.category,
               'limite', s.wip_limit,
               'cards_agora', (select count(*) from c where c.stage_id = s.id),
               'saidas_no_periodo', coalesce(st.n, 0),
               'tempo_medio_na_etapa_dias', round((st.avg_s / 86400)::numeric, 1))
             order by s.position, s.name)
      from stage s left join stays st on st.stage_id = s.id
      where s.board_id = p_board and s.archived_at is null), '[]'::jsonb)
  )
  where public.can_see_board(p_board)
$$;

-- atividades (linha do tempo: histórico dos cards + comentários)
create or replace function public.report_activity(
  p_from timestamptz, p_to timestamptz,
  p_board uuid default null, p_user uuid default null, p_limit integer default 100
)
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select * from public.report_scope_cards() where p_board is null or board_id = p_board
  ),
  ev as (
    select a.created_at, a.kind, a.actor_id, a.card_id,
           case a.kind
             when 'card_moved' then format('de "%s" para "%s"',
               coalesce((select name from stage where id = nullif(a.payload->>'fromStageId','')::uuid), '?'),
               coalesce((select name from stage where id = nullif(a.payload->>'toStageId','')::uuid), '?'))
             when 'assignment_changed' then
               'responsável: ' || coalesce(public.report_user_name(nullif(a.payload->>'userId','')::uuid), 'ninguém')
             when 'checklist_checked' then left(a.payload->>'text', 200)
             when 'checklist_unchecked' then left(a.payload->>'text', 200)
             else null
           end as detail
    from activity a join c on c.id = a.card_id
    where a.created_at >= p_from and a.created_at < p_to
    union all
    select m.created_at, 'comment', m.author_id, m.card_id, left(m.body, 200)
    from comment m join c on c.id = m.card_id
    where m.archived_at is null and m.created_at >= p_from and m.created_at < p_to
  ),
  picked as (
    select ev.* from ev
    where p_user is null or ev.actor_id = p_user
    order by ev.created_at desc
    limit least(greatest(p_limit, 1), 300)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'total_no_periodo', (select count(*) from ev where p_user is null or ev.actor_id = p_user),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quando', p.created_at,
               'tipo', case p.kind
                         when 'card_created' then 'card criado'
                         when 'card_moved' then 'card movido'
                         when 'assignment_changed' then 'responsável alterado'
                         when 'checklist_checked' then 'item de checklist concluído'
                         when 'checklist_unchecked' then 'item de checklist desmarcado'
                         when 'demand_prioritized' then 'demanda priorizada'
                         when 'demand_deprioritized' then 'demanda despriorizada'
                         when 'comment' then 'comentário'
                         else p.kind end,
               'quem', public.report_user_name(p.actor_id),
               'card', format('#%s %s', c.number, c.title),
               'pipeline', c.board_name,
               'detalhe', p.detail)
             order by p.created_at desc)
      from picked p join c on c.id = p.card_id), '[]'::jsonb)
  )
$$;

-- produtividade_usuario (p_user nulo = todas as pessoas com algum número)
create or replace function public.report_user_productivity(
  p_user uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb language sql stable set search_path = public as $$
  with c as (select * from public.report_scope_cards()),
  people as (
    select u.id from app_user u
    where u.organization_id = public.current_org() and u.archived_at is null
      and (p_user is null or u.id = p_user)
  ),
  m as (
    select
      p.id,
      (select count(*) from c where c.responsible_id = p.id
         and c.completed_at >= p_from and c.completed_at < p_to)                as concluidos,
      (select round((avg(extract(epoch from c.completed_at - c.created_at)) / 86400)::numeric, 1)
         from c where c.responsible_id = p.id
         and c.completed_at >= p_from and c.completed_at < p_to)                as tempo_medio,
      (select count(*) from activity a join c on c.id = a.card_id
         where a.actor_id = p.id and a.kind = 'card_moved'
         and a.created_at >= p_from and a.created_at < p_to)                    as movimentacoes,
      (select count(*) from activity a join c on c.id = a.card_id
         where a.actor_id = p.id and a.kind = 'card_created'
         and a.created_at >= p_from and a.created_at < p_to)                    as criados,
      (select count(*) from activity a join c on c.id = a.card_id
         where a.actor_id = p.id and a.kind = 'checklist_checked'
         and a.created_at >= p_from and a.created_at < p_to)                    as itens_checklist,
      (select count(*) from comment k join c on c.id = k.card_id
         where k.author_id = p.id and k.archived_at is null
         and k.created_at >= p_from and k.created_at < p_to)                    as comentarios,
      (select count(*) from c where c.responsible_id = p.id
         and c.stage_category <> 'done')                                        as em_aberto,
      (select count(*) from c where c.responsible_id = p.id
         and c.stage_category <> 'done'
         and c.due_date < (now() at time zone 'America/Sao_Paulo')::date)       as atrasados
    from people p
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'observacao', 'Só contam cards dos pipelines que você enxerga.',
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pessoa', public.report_user_name(m.id),
               'cards_concluidos', m.concluidos,
               'tempo_medio_de_conclusao_dias', m.tempo_medio,
               'movimentacoes', m.movimentacoes,
               'cards_criados', m.criados,
               'comentarios', m.comentarios,
               'itens_de_checklist', m.itens_checklist,
               'cards_em_aberto_agora', m.em_aberto,
               'cards_atrasados_agora', m.atrasados)
             order by m.concluidos desc, m.movimentacoes desc)
      from m
      where p_user is not null
         or m.concluidos + m.movimentacoes + m.criados + m.comentarios + m.em_aberto > 0), '[]'::jsonb)
  )
$$;

-- produtividade_pipeline (comparativo entre pipelines)
create or replace function public.report_pipeline_productivity(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with c as (select * from public.report_scope_cards()),
  stays as (
    select s.board_id, s.stage_id, avg(s.seconds) as avg_s
    from public.report_stage_stays() s
    where s.left_at >= p_from and s.left_at < p_to
    group by s.board_id, s.stage_id
  ),
  weeks as (select greatest(extract(epoch from p_to - p_from) / 604800.0, 1.0 / 7) as n)
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'pipelines', coalesce((
      select jsonb_agg(row order by row->>'pipeline')
      from (
        select jsonb_build_object(
          'pipeline', b.name,
          'criados', (select count(*) from c where c.board_id = b.id
                       and c.created_at >= p_from and c.created_at < p_to),
          'concluidos', (select count(*) from c where c.board_id = b.id
                          and c.completed_at >= p_from and c.completed_at < p_to),
          'vazao_por_semana', (select round(((select count(*) from c where c.board_id = b.id
                                and c.completed_at >= p_from and c.completed_at < p_to)
                                / w.n)::numeric, 1) from weeks w),
          'tempo_de_ciclo_medio_dias', (
            select round((avg(extract(epoch from c.completed_at - c.created_at)) / 86400)::numeric, 1)
            from c where c.board_id = b.id and c.completed_at >= p_from and c.completed_at < p_to),
          'em_aberto_agora', (select count(*) from c where c.board_id = b.id and c.stage_category <> 'done'),
          'gargalo', (
            select jsonb_build_object('etapa', s.name,
                     'tempo_medio_na_etapa_dias', round((st.avg_s / 86400)::numeric, 1))
            from stays st join stage s on s.id = st.stage_id
            where st.board_id = b.id and s.category <> 'done'
            order by st.avg_s desc limit 1)
        ) as row
        from board b
        where b.archived_at is null and public.can_see_board(b.id)
      ) x), '[]'::jsonb)
  )
$$;

-- buscar_cards
create or replace function public.report_search_cards(
  p_text text default null, p_board uuid default null, p_stage text default null,
  p_responsible uuid default null, p_only_open boolean default false,
  p_only_overdue boolean default false, p_limit integer default 30
)
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select * from public.report_scope_cards() c
    where (p_board is null or c.board_id = p_board)
      and (p_stage is null or c.stage_name ilike '%' || p_stage || '%')
      and (p_responsible is null or c.responsible_id = p_responsible)
      and (not p_only_open or c.stage_category <> 'done')
      and (not p_only_overdue or (c.stage_category <> 'done'
           and c.due_date < (now() at time zone 'America/Sao_Paulo')::date))
      and (p_text is null or p_text = ''
           or c.title ilike '%' || p_text || '%'
           or c.number::text = ltrim(p_text, '#'))
  )
  select jsonb_build_object(
    'encontrados', (select count(*) from c),
    'cards', coalesce((
      select jsonb_agg(row) from (
        select jsonb_build_object(
          'id', c.id,
          'card', format('#%s %s', c.number, c.title),
          'pipeline', c.board_name,
          'etapa', c.stage_name,
          'responsavel', public.report_user_name(c.responsible_id),
          'prazo', c.due_date,
          'atrasado', c.stage_category <> 'done'
                      and c.due_date < (now() at time zone 'America/Sao_Paulo')::date,
          'concluido', c.stage_category = 'done',
          'dias_na_etapa', floor(extract(epoch from now() - c.stage_entered_at) / 86400)
        ) as row
        from c
        order by c.stage_entered_at desc
        limit least(greatest(p_limit, 1), 100)
      ) x), '[]'::jsonb)
  )
$$;

-- detalhe_card
create or replace function public.report_card_detail(p_card uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', c.id,
    'card', format('#%s %s', c.number, c.title),
    'pipeline', c.board_name,
    'etapa', c.stage_name,
    'concluido', c.stage_category = 'done',
    'responsavel', public.report_user_name(c.responsible_id),
    'solicitante', public.report_user_name(c.requester_id),
    'prazo', c.due_date,
    'criado_em', c.created_at,
    'na_etapa_desde', c.stage_entered_at,
    'concluido_em', c.completed_at,
    -- Descrição sem as marcações de formatação e limitada (pode ser longa).
    'descricao', (select left(regexp_replace(regexp_replace(coalesce(k.description, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'), 2000)
                    from card k where k.id = c.id),
    'propriedades', coalesce((
      select jsonb_agg(jsonb_build_object('nome', f.name, 'valor',
               case f.type
                 when 'checkbox' then case when v.value_bool then 'sim' else 'não' end
                 when 'number' then v.value_number::text
                 when 'date' then v.value_date::text
                 when 'member' then public.report_user_name(v.value_member_id)
                 when 'select' then coalesce((select o->>'label' from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
                                               where o->>'id' = v.value_text limit 1), v.value_text)
                 when 'status' then coalesce((select o->>'label' from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
                                               where o->>'id' = v.value_text limit 1), v.value_text)
                 else left(v.value_text, 500)
               end) order by f.position)
      from field_value v join field_definition f on f.id = v.field_definition_id
      where v.card_id = c.id and f.archived_at is null), '[]'::jsonb),
    'checklists', coalesce((
      select jsonb_agg(jsonb_build_object('nome', l.name, 'itens', coalesce((
               select jsonb_agg(jsonb_build_object('texto', i.text, 'feito', i.done) order by i.position)
               from checklist_item i where i.checklist_id = l.id), '[]'::jsonb)) order by l.position)
      from checklist l where l.card_id = c.id and l.archived_at is null), '[]'::jsonb),
    'comentarios', coalesce((
      select jsonb_agg(row order by row->>'quando') from (
        select jsonb_build_object('quando', m.created_at, 'quem', public.report_user_name(m.author_id),
                                  'texto', left(m.body, 1000)) as row
        from comment m where m.card_id = c.id and m.archived_at is null
        order by m.created_at desc limit 30) x), '[]'::jsonb),
    'historico', coalesce((
      select jsonb_agg(row order by row->>'quando') from (
        select jsonb_build_object(
          'quando', a.created_at, 'quem', public.report_user_name(a.actor_id), 'tipo', a.kind,
          'de', (select name from stage where id = nullif(a.payload->>'fromStageId','')::uuid),
          'para', (select name from stage where id = nullif(a.payload->>'toStageId','')::uuid)) as row
        from activity a where a.card_id = c.id
        order by a.created_at desc limit 50) x), '[]'::jsonb)
  )
  from public.report_scope_cards() c
  where c.id = p_card
$$;

-- ── 5. Porta única do Worker MCP ────────────────────────────────────────────

create or replace function public.mcp_call(p_token_hash text, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t        api_token%rowtype;
  args     jsonb := coalesce(p_args, '{}'::jsonb);
  v_from   timestamptz;
  v_to     timestamptz;
  v_days   integer;
  v_board  uuid;
  v_user   uuid;
  v_card   uuid;
  v_txt    text;
  n        integer;
  res      jsonb;
  err      text;
begin
  -- Token válido, não revogado, não vencido, de pessoa ativa.
  select * into t from api_token where token_hash = p_token_hash;
  if not found or t.revoked_at is not null
     or (t.expires_at is not null and t.expires_at < now())
     or not exists (select 1 from app_user u where u.id = t.user_id and u.archived_at is null) then
    return jsonb_build_object('error', jsonb_build_object('code', 'invalid_token',
      'message', 'Token inválido, revogado ou vencido.'));
  end if;

  -- Limite: 60 chamadas por minuto por token.
  select count(*) into n from api_token_call
   where token_id = t.id and created_at > now() - interval '1 minute';
  if n >= 60 then
    return jsonb_build_object('error', jsonb_build_object('code', 'rate_limited',
      'message', 'Muitas consultas em pouco tempo. Aguarde um minuto.'));
  end if;

  -- Daqui em diante, tudo é lido COMO o dono do token (só nesta transação).
  perform set_config('request.jwt.claims',
    json_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);

  if not public.has_permission('report:read') then
    insert into api_token_call (token_id, tool, ok) values (t.id, left(p_tool, 60), false);
    return jsonb_build_object('error', jsonb_build_object('code', 'forbidden',
      'message', 'Sua conta não tem a permissão de relatórios (report:read).'));
  end if;

  -- Período: {"dias": N} (padrão 30, máx. 366) ou {"de": "AAAA-MM-DD", "ate": "AAAA-MM-DD"}.
  begin
    v_days := least(greatest(coalesce((args->>'dias')::integer, 30), 1), 366);
    v_to := coalesce(((args->>'ate')::date + 1)::timestamp at time zone 'America/Sao_Paulo', now());
    v_from := coalesce((args->>'de')::date::timestamp at time zone 'America/Sao_Paulo',
                       v_to - make_interval(days => v_days));
  exception when others then
    err := 'Período inválido. Use "dias" (número) ou "de"/"ate" no formato AAAA-MM-DD.';
  end;

  -- Pipeline: id ou parte do nome, entre os que a pessoa enxerga.
  v_txt := nullif(trim(args->>'pipeline'), '');
  if err is null and v_txt is not null then
    select count(*), min(b.id::text)::uuid into n, v_board from board b
     where b.archived_at is null and public.can_see_board(b.id)
       and (b.id::text = v_txt or b.name ilike '%' || v_txt || '%');
    if n = 0 then err := format('Nenhum pipeline com "%s". Use listar_pipelines para ver os nomes.', v_txt);
    elsif n > 1 then
      -- Nome exato desempata.
      select count(*), min(b.id::text)::uuid into n, v_board from board b
       where b.archived_at is null and public.can_see_board(b.id) and lower(b.name) = lower(v_txt);
      if n <> 1 then err := format('Mais de um pipeline combina com "%s". Informe o nome completo.', v_txt); end if;
    end if;
  end if;

  -- Pessoa: id, parte do nome ou e-mail. Ver OUTRA pessoa exige user:manage.
  v_txt := nullif(trim(args->>'usuario'), '');
  if err is null and v_txt is not null then
    select count(*), min(u.id::text)::uuid into n, v_user from app_user u
     where u.organization_id = public.current_org() and u.archived_at is null
       and (u.id::text = v_txt or u.name ilike '%' || v_txt || '%' or u.email ilike v_txt);
    if n = 0 then err := format('Ninguém encontrado com "%s".', v_txt);
    elsif n > 1 then err := format('Mais de uma pessoa combina com "%s". Informe o nome completo.', v_txt);
    end if;
  end if;

  if err is null then
    case p_tool
      when 'listar_pipelines' then
        res := public.report_pipelines();

      when 'resumo_pipeline' then
        if v_board is null then err := 'Informe o pipeline (nome ou parte do nome).';
        else res := public.report_pipeline_summary(v_board, v_from, v_to); end if;

      when 'atividades' then
        if v_user is not null and v_user <> t.user_id and not public.has_permission('user:manage') then
          err := 'Você só pode filtrar as atividades por você mesmo.';
        else
          res := public.report_activity(v_from, v_to, v_board, v_user,
                   coalesce((args->>'limite')::integer, 100));
        end if;

      when 'produtividade_usuario' then
        if public.has_permission('user:manage') then
          res := public.report_user_productivity(v_user, v_from, v_to);
        elsif v_user is not null and v_user <> t.user_id then
          err := 'Você só pode ver os seus próprios números.';
        else
          res := public.report_user_productivity(t.user_id, v_from, v_to);
        end if;

      when 'produtividade_pipeline' then
        res := public.report_pipeline_productivity(v_from, v_to);

      when 'buscar_cards' then
        res := public.report_search_cards(
          nullif(trim(args->>'texto'), ''), v_board, nullif(trim(args->>'etapa'), ''), v_user,
          coalesce((args->>'so_em_aberto')::boolean, false),
          coalesce((args->>'so_atrasados')::boolean, false),
          coalesce((args->>'limite')::integer, 30));

      when 'detalhe_card' then
        v_txt := nullif(trim(args->>'card'), '');
        if v_txt is null then err := 'Informe o card: o id, ou o número (ex.: "#142") junto com o pipeline.';
        elsif v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_card := v_txt::uuid;
        elsif ltrim(v_txt, '#') ~ '^[0-9]+$' then
          select count(*), min(c.id::text)::uuid into n, v_card from public.report_scope_cards() c
           where c.number = ltrim(v_txt, '#')::bigint and (v_board is null or c.board_id = v_board);
          if n = 0 then err := format('Card %s não encontrado.', v_txt);
          elsif n > 1 then err := format('Há mais de um card %s. Informe também o pipeline.', v_txt);
          end if;
        else err := 'Card inválido: use o id ou o número (ex.: "#142").';
        end if;
        if err is null then
          res := public.report_card_detail(v_card);
          if res is null then err := 'Card não encontrado.'; end if;
        end if;

      else
        err := format('Ferramenta desconhecida: %s', left(p_tool, 60));
    end case;
  end if;

  insert into api_token_call (token_id, tool, ok) values (t.id, left(p_tool, 60), err is null);
  update api_token set last_used_at = now() where id = t.id;

  if err is not null then
    return jsonb_build_object('error', jsonb_build_object('code', 'bad_request', 'message', err));
  end if;
  return jsonb_build_object('result', coalesce(res, 'null'::jsonb));
end$$;

-- ── Permissões de execução ──────────────────────────────────────────────────
-- Regra da casa (ver 0038): função nasce fechada e recebe só o grant necessário.

do $$
declare f text;
begin
  foreach f in array array[
    'public.report_user_name(uuid)',
    'public.report_scope_cards()',
    'public.report_stage_stays()',
    'public.report_pipelines()',
    'public.report_pipeline_summary(uuid, timestamptz, timestamptz, integer)',
    'public.report_activity(timestamptz, timestamptz, uuid, uuid, integer)',
    'public.report_user_productivity(uuid, timestamptz, timestamptz)',
    'public.report_pipeline_productivity(timestamptz, timestamptz)',
    'public.report_search_cards(text, uuid, text, uuid, boolean, boolean, integer)',
    'public.report_card_detail(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;

-- `mcp_call` é chamada pelo Worker MCP só com a chave PÚBLICA do Supabase:
-- quem autentica é o token pessoal (256 bits aleatórios, conferido pelo hash).
revoke all on function public.mcp_call(text, text, jsonb) from public;
grant execute on function public.mcp_call(text, text, jsonb) to anon, authenticated, service_role;
