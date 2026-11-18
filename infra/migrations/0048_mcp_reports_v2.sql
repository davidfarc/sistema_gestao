-- ============================================================================
-- 0048_mcp_reports_v2.sql — Relatórios para assistentes de IA, 2ª versão
-- (SPEC-FASE2 §D, ajustes de 17/11 a partir do uso real)
--
-- O primeiro uso com um assistente mostrou três limites, corrigidos aqui:
--
-- 1. NÃO HAVIA HORAS. Nova consulta `tempo_por_tarefa` (função `report_time`):
--    horas do cronômetro por pessoa, por pipeline, por card e por dia. O
--    detalhe do card passa a trazer o tempo registrado e as emendas. Quem não
--    tem `time:read` vê só o próprio tempo.
-- 2. `atividades` CORTAVA EM 300 SEM AVISAR e sem como continuar. Agora aceita
--    `pular` (paginação) e devolve `proxima_pagina` e `truncado`.
-- 3. LOTES INFLAVAM A CONTAGEM. Uma importação gera um evento por card no mesmo
--    instante. Por padrão, 5 ou mais eventos da mesma pessoa, do mesmo tipo e no
--    mesmo segundo viram UMA linha ("lote", com a quantidade).
--
-- Também: horário de São Paulo em cada evento; tipos novos traduzidos (prazo,
-- emendas, arquivar, envio, tempo corrigido, registro importado); e o alcance
-- dos relatórios passa a respeitar a permissão "ver todos os cards" (0047).
--
-- Só troca funções (nenhuma tabela, nenhum dado). Idempotente.
-- ============================================================================

-- ── Alcance: respeita "ver todos os cards do pipeline" ──────────────────────
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
  internal as materialized (select public.is_internal() as yes, public.has_permission('card:read_all') as all_cards)
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
    -- Interno com "ver todos os cards" (0047) vê todos os dos pipelines dele;
    -- sem a permissão, e os externos, só os que `can_see_card` libera.
    and ((i.yes and i.all_cards) or public.can_see_card(c.id))
$$;


-- ── atividades: paginação, lotes agrupados e horário local ──────────────────
drop function if exists public.report_activity(timestamptz, timestamptz, uuid, uuid, integer);

create or replace function public.report_activity(
  p_from timestamptz, p_to timestamptz,
  p_board uuid default null, p_user uuid default null,
  p_limit integer default 100, p_offset integer default 0, p_group boolean default true
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
             when 'due_date_changed' then format('de %s para %s',
               coalesce(a.payload->>'from', 'sem prazo'), coalesce(a.payload->>'to', 'sem prazo'))
             when 'rework_changed' then format('de %s para %s', a.payload->>'from', a.payload->>'to')
             when 'card_transferred' then format('de "%s" para "%s"',
               coalesce(a.payload->>'fromBoardName', '?'), coalesce(a.payload->>'toBoardName', '?'))
             else left(a.payload->>'text', 200)
           end as detail
    from activity a join c on c.id = a.card_id
    where a.created_at >= p_from and a.created_at < p_to
    union all
    select m.created_at, 'comment', m.author_id, m.card_id, left(m.body, 200)
    from comment m join c on c.id = m.card_id
    where m.archived_at is null and m.created_at >= p_from and m.created_at < p_to
  ),
  mine as (
    select ev.*, date_trunc('second', ev.created_at) as sec from ev
    where p_user is null or ev.actor_id = p_user
  ),
  sized as (
    select m.*, count(*) over (partition by m.actor_id, m.kind, m.sec) as lote from mine m
  ),
  -- Uma linha por ação: os lotes (5+ no mesmo segundo) viram uma só.
  acts as (
    select s.created_at, s.kind, s.actor_id, s.card_id, s.detail, 1::bigint as qtd, false as is_lote
      from sized s where not p_group or s.lote < 5
    union all
    select min(s.created_at), s.kind, s.actor_id, null::uuid,
           format('%s cards no mesmo instante (ação em lote): %s', count(*),
                  (select string_agg(distinct cc.board_name, ', ') from c cc
                    where cc.id = any (array_agg(s.card_id)))),
           count(*), true
      from sized s where p_group and s.lote >= 5
     group by s.actor_id, s.kind, s.sec
  ),
  picked as (
    select * from acts
    order by created_at desc, kind, card_id
    limit least(greatest(p_limit, 1), 300) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'fuso', 'America/Sao_Paulo',
    -- Eventos brutos (um por card, mesmo nos lotes) e ações (lotes contam 1).
    'total_de_eventos', (select count(*) from mine),
    'total_de_acoes', (select count(*) from acts),
    'devolvidas', (select count(*) from picked),
    'truncado', (select count(*) from acts) > greatest(p_offset, 0) + (select count(*) from picked),
    'proxima_pagina', case
      when (select count(*) from acts) > greatest(p_offset, 0) + (select count(*) from picked)
        then greatest(p_offset, 0) + (select count(*) from picked) end,
    'eventos', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'quando', p.created_at,
               'quando_local', to_char(p.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
               'tipo', case p.kind
                         when 'card_created' then 'card criado'
                         when 'card_moved' then 'card movido'
                         when 'assignment_changed' then 'responsável alterado'
                         when 'checklist_checked' then 'item de checklist concluído'
                         when 'checklist_unchecked' then 'item de checklist desmarcado'
                         when 'demand_prioritized' then 'demanda priorizada'
                         when 'demand_deprioritized' then 'demanda despriorizada'
                         when 'due_date_changed' then 'prazo alterado'
                         when 'rework_changed' then 'emendas corrigidas'
                         when 'time_edited' then 'tempo corrigido'
                         when 'card_archived' then 'card arquivado'
                         when 'card_restored' then 'card reativado'
                         when 'card_transferred' then 'card enviado a outro pipeline'
                         when 'legacy_note' then 'registro importado'
                         when 'comment' then 'comentário'
                         else p.kind end,
               'quem', public.report_user_name(p.actor_id),
               'lote', case when p.is_lote then true end,
               'quantidade', case when p.is_lote then p.qtd end,
               'card', case when c.id is not null then format('#%s %s', c.number, c.title) end,
               'pipeline', c.board_name,
               'detalhe', p.detail))
             order by p.created_at desc)
      from picked p left join c on c.id = p.card_id), '[]'::jsonb)
  )
$$;

-- ── tempo_por_tarefa: horas do cronômetro ───────────────────────────────────
-- Conta só o trecho de cada período que cai dentro do intervalo pedido.
create or replace function public.report_time(
  p_from timestamptz, p_to timestamptz, p_board uuid default null, p_user uuid default null
)
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select * from public.report_scope_cards() where p_board is null or board_id = p_board
  ),
  e as (
    select te.user_id, te.card_id, te.started_at, te.ended_at, te.edited_at,
           greatest(0, extract(epoch from
             least(coalesce(te.ended_at, now()), p_to) - greatest(te.started_at, p_from))) as seg,
           c.board_name, c.number, c.title
      from time_entry te join c on c.id = te.card_id
     where te.started_at < p_to and coalesce(te.ended_at, now()) > p_from
       and (public.has_permission('time:read') or te.user_id = auth.uid())
       and (p_user is null or te.user_id = p_user)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_from, 'ate', p_to),
    'fuso', 'America/Sao_Paulo',
    'alcance', case when public.has_permission('time:read') then 'equipe' else 'só o próprio tempo' end,
    'total_horas', round(coalesce((select sum(seg) from e), 0) / 3600.0, 2),
    'periodos_registrados', (select count(*) from e),
    'periodos_corrigidos_a_mao', (select count(*) from e where edited_at is not null),
    'por_pessoa', coalesce((
      select jsonb_agg(jsonb_build_object('quem', x.quem, 'horas', round(x.seg / 3600.0, 2), 'cards', x.cards)
                       order by x.seg desc)
      from (select public.report_user_name(user_id) as quem, sum(seg) as seg, count(distinct card_id) as cards
              from e group by user_id) x), '[]'::jsonb),
    'por_pipeline', coalesce((
      select jsonb_agg(jsonb_build_object('pipeline', x.board_name, 'horas', round(x.seg / 3600.0, 2), 'cards', x.cards)
                       order by x.seg desc)
      from (select board_name, sum(seg) as seg, count(distinct card_id) as cards from e group by board_name) x), '[]'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', x.dia, 'horas', round(x.seg / 3600.0, 2)) order by x.dia)
      from (select to_char(started_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, sum(seg) as seg
              from e group by 1) x), '[]'::jsonb),
    'por_card', coalesce((
      select jsonb_agg(jsonb_build_object('card', format('#%s %s', x.number, x.title), 'pipeline', x.board_name,
                                          'horas', round(x.seg / 3600.0, 2), 'pessoas', x.pessoas)
                       order by x.seg desc)
      from (select number, title, board_name, sum(seg) as seg,
                   (select string_agg(distinct public.report_user_name(e2.user_id), ', ') from e e2 where e2.card_id = e.card_id) as pessoas
              from e group by card_id, number, title, board_name
             order by sum(seg) desc limit 50) x), '[]'::jsonb),
    'em_andamento_agora', coalesce((
      select jsonb_agg(jsonb_build_object('quem', public.report_user_name(user_id),
                                          'card', format('#%s %s', number, title), 'pipeline', board_name,
                                          'desde_local', to_char(started_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')))
      from e where ended_at is null), '[]'::jsonb)
  )
$$;

-- ── detalhe_card: emendas, tempo registrado e texto no histórico ────────────
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
    'emendas', (select k.rework_count from card k where k.id = c.id),
    -- Tempo cronometrado no card. Quem não tem `time:read` vê só o próprio.
    'tempo_registrado', (
      select jsonb_build_object(
        'total_horas', round(coalesce(sum(x.segundos), 0) / 3600.0, 2),
        'por_pessoa', coalesce(jsonb_agg(jsonb_build_object('quem', x.quem, 'horas', round(x.segundos / 3600.0, 2))
                                order by x.segundos desc), '[]'::jsonb))
      from (
        select public.report_user_name(te.user_id) as quem,
               sum(extract(epoch from coalesce(te.ended_at, now()) - te.started_at)) as segundos
          from time_entry te
         where te.card_id = c.id
           and (public.has_permission('time:read') or te.user_id = auth.uid())
         group by te.user_id) x),
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
          'detalhe', case
            when a.kind in ('due_date_changed', 'rework_changed') then format('de %s para %s',
              coalesce(a.payload->>'from', 'vazio'), coalesce(a.payload->>'to', 'vazio'))
            else left(a.payload->>'text', 300) end,
          'de', (select name from stage where id = nullif(a.payload->>'fromStageId','')::uuid),
          'para', (select name from stage where id = nullif(a.payload->>'toStageId','')::uuid)) as row
        from activity a where a.card_id = c.id
        order by a.created_at desc limit 50) x), '[]'::jsonb)
  )
  from public.report_scope_cards() c
  where c.id = p_card
$$;


-- ── Porta única do Worker MCP ───────────────────────────────────────────────
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
                   coalesce((args->>'limite')::integer, 100),
                   greatest(coalesce((args->>'pular')::integer, 0), 0),
                   coalesce((args->>'agrupar_lotes')::boolean, true));
        end if;

      when 'tempo_por_tarefa' then
        -- Sem `time:read`, a pessoa vê só o próprio tempo (a função filtra).
        if v_user is not null and v_user <> t.user_id and not public.has_permission('time:read') then
          err := 'Você só pode ver o seu próprio tempo.';
        else
          res := public.report_time(v_from, v_to, v_board, v_user);
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
do $$
declare f text;
begin
  foreach f in array array[
    'public.report_scope_cards()',
    'public.report_activity(timestamptz, timestamptz, uuid, uuid, integer, integer, boolean)',
    'public.report_time(timestamptz, timestamptz, uuid, uuid)',
    'public.report_card_detail(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;

revoke all on function public.mcp_call(text, text, jsonb) from public;
grant execute on function public.mcp_call(text, text, jsonb) to anon, authenticated, service_role;
