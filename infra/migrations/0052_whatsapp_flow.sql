-- ============================================================================
-- 0052_whatsapp_flow.sql — WhatsApp: avisos, liberação e lembretes
-- (SPEC-FASE2 §C, etapas C3 e C4)
--
-- 1. Opções do pipeline: `release_required` (pedido novo só sai da 1ª etapa
--    pelas mãos da gestão) e `whatsapp_reminder_days` (lembrete de card parado;
--    0 desliga).
-- 2. `whatsapp_outbox`: fila de avisos a enviar. Um gatilho em `activity` a
--    alimenta quando um card de pipeline atendido é criado, muda de etapa ou
--    ganha responsável: avisa o solicitante, o responsável e os gestores de
--    área do pipeline (nunca quem fez a ação, e só quem tem telefone).
-- 3. `whatsapp_outbox_take` / `_done`: o Worker pega a fila a cada minuto.
-- 4. `whatsapp_enqueue_reminders`: lembrete ao responsável de card parado.
-- 5. `whatsapp_inbound`: conta as respostas a número não cadastrado (máx. 3).
-- 6. `whatsapp_agent`: ferramentas novas `preparar_liberacao` (só confere; quem
--    move é o site, pelo CardService) e `comentar_pedido`.
--
-- Nada lê as tabelas pelo navegador; funções só com a chave de servidor.
-- Só aditiva. Idempotente.
-- ============================================================================

alter table board add column if not exists release_required       boolean not null default false;
alter table board add column if not exists whatsapp_reminder_days integer not null default 3
  check (whatsapp_reminder_days between 0 and 60);

create table if not exists whatsapp_outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  user_id         uuid not null references app_user(id) on delete cascade,
  card_id         uuid references card(id) on delete cascade,
  kind            text not null,
  phone           text not null,
  body            text not null,
  attempts        integer not null default 0,
  taken_at        timestamptz,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists whatsapp_outbox_pending_idx on whatsapp_outbox (created_at) where sent_at is null;
create index if not exists whatsapp_outbox_card_idx on whatsapp_outbox (card_id, kind, created_at desc);

alter table whatsapp_outbox enable row level security;
alter table whatsapp_outbox force row level security;
revoke all on whatsapp_outbox from anon, authenticated;

-- Enfileira um aviso, se a pessoa tem telefone. Freio: no máximo 8 avisos por
-- pessoa por minuto (uma importação em massa não vira enxurrada no celular).
create or replace function public.whatsapp_enqueue(p_user uuid, p_card uuid, p_kind text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text; v_org uuid;
begin
  if p_user is null then return; end if;
  select p.phone, a.organization_id into v_phone, v_org
    from user_phone p join app_user a on a.id = p.user_id
   where p.user_id = p_user and a.archived_at is null and a.is_internal;
  if v_phone is null then return; end if;
  if (select count(*) from whatsapp_outbox
       where user_id = p_user and created_at > now() - interval '1 minute') >= 8 then
    return;
  end if;
  insert into whatsapp_outbox (organization_id, user_id, card_id, kind, phone, body)
  values (v_org, p_user, p_card, p_kind, v_phone, left(p_body, 1500));
end$$;

create or replace function public.whatsapp_notify_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_actor  text;
  v_resp   uuid;
  v_new    uuid;
  v_stage  text;
  v_done   boolean;
  v_ref    text;
  m        uuid;
begin
  if new.kind not in ('card_created', 'card_moved', 'assignment_changed') then return new; end if;
  begin
    select c.id, c.number, c.title, c.requester_id, c.board_id, b.name as board_name,
           b.whatsapp_enabled, b.release_required, s.name as stage_name, s.category
      into r
      from card c join board b on b.id = c.board_id join stage s on s.id = c.stage_id
     where c.id = new.card_id;
    if r.id is null or not r.whatsapp_enabled then return new; end if;

    select coalesce(nullif(a.name, ''), a.email) into v_actor from app_user a where a.id = new.actor_id;
    v_actor := coalesce(v_actor, 'Alguém');
    select g.user_id into v_resp from assignment g where g.card_id = r.id and g.stage_id is null limit 1;
    v_ref := format('#%s «%s» (%s)', r.number, left(r.title, 80), r.board_name);

    if new.kind = 'card_created' then
      for m in select distinct ur.user_id from user_role ur
                 join role ro on ro.id = ur.role_id and ro.slug = 'area'
                 join board_member bm on bm.user_id = ur.user_id and bm.board_id = r.board_id
                where ur.user_id is distinct from new.actor_id loop
        perform public.whatsapp_enqueue(m, r.id, 'created',
          format('Novo pedido %s, aberto por %s.', v_ref, v_actor)
          || case when r.release_required
                  then format(' Ele aguarda a sua liberação. Para liberar, responda: liberar %s', r.number)
                  else '' end);
      end loop;

    elsif new.kind = 'card_moved' then
      select s.name, s.category = 'done' into v_stage, v_done
        from stage s where s.id = nullif(new.payload->>'toStageId', '')::uuid;
      v_stage := coalesce(v_stage, r.stage_name);
      v_done := coalesce(v_done, r.category = 'done');
      for m in
        select x.uid from (
          select r.requester_id as uid
          union select v_resp
          union select ur.user_id from user_role ur
                  join role ro on ro.id = ur.role_id and ro.slug = 'area'
                  join board_member bm on bm.user_id = ur.user_id and bm.board_id = r.board_id) x
         where x.uid is not null and x.uid is distinct from new.actor_id loop
        perform public.whatsapp_enqueue(m, r.id, 'moved',
          case when m = r.requester_id then 'Seu pedido ' else 'Pedido ' end || v_ref ||
          case when v_done then format(' foi concluído por %s.', v_actor)
               else format(' foi para a etapa "%s" (por %s).', v_stage, v_actor) end);
      end loop;

    else -- assignment_changed
      v_new := nullif(new.payload->>'userId', '')::uuid;
      if v_new is not null and v_new is distinct from new.actor_id then
        perform public.whatsapp_enqueue(v_new, r.id, 'assigned',
          format('%s colocou você como responsável pelo pedido %s. Quando tiver novidade, responda aqui que eu registro no card.',
                 v_actor, v_ref));
      end if;
      if r.requester_id is distinct from new.actor_id and r.requester_id is distinct from v_new and v_new is not null then
        perform public.whatsapp_enqueue(r.requester_id, r.id, 'assigned',
          format('Seu pedido %s agora está com %s.', v_ref,
                 (select coalesce(nullif(a.name, ''), a.email) from app_user a where a.id = v_new)));
      end if;
    end if;
  exception when others then
    -- Aviso é acessório: uma falha aqui nunca pode impedir o registro da atividade.
    raise warning 'whatsapp_notify_activity: %', sqlerrm;
  end;
  return new;
end$$;

drop trigger if exists whatsapp_notify_activity on activity;
create trigger whatsapp_notify_activity
  after insert on activity
  for each row execute function public.whatsapp_notify_activity();

-- O Worker pega um lote. Quem foi pego e não confirmou volta à fila em 5 minutos;
-- depois de 3 tentativas ou de 1 dia, o aviso é abandonado.
create or replace function public.whatsapp_outbox_take(p_limit integer default 20)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id from whatsapp_outbox
     where sent_at is null and attempts < 3
       and (taken_at is null or taken_at < now() - interval '5 minutes')
       and created_at > now() - interval '1 day'
     order by created_at
     limit least(greatest(p_limit, 1), 50)
     for update skip locked
  ), upd as (
    update whatsapp_outbox o set attempts = o.attempts + 1, taken_at = now()
      from picked where o.id = picked.id
    returning o.id, o.phone, o.body, o.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'body', body) order by created_at), '[]'::jsonb)
    from upd
$$;

create or replace function public.whatsapp_outbox_done(p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o record;
begin
  update whatsapp_outbox set sent_at = case when p_error is null then now() end, error = left(p_error, 200)
   where id = p_id returning * into o;
  if o.id is null or p_error is not null then return; end if;
  -- Entra na conversa: se a pessoa responder ("liberar 142"), o agente tem o contexto.
  insert into whatsapp_message (organization_id, user_id, phone, direction, body)
  values (o.organization_id, o.user_id, o.phone, 'out', o.body);
  delete from whatsapp_outbox where created_at < now() - interval '90 days';
end$$;

-- Lembrete de card parado: em dia útil, das 8h às 18h (São Paulo), para o
-- responsável de card liberado e não concluído, sem movimentação nem comentário
-- há N dias (opção do pipeline), no máximo um lembrete a cada N dias por card.
create or replace function public.whatsapp_enqueue_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  x record;
  n integer := 0;
begin
  if extract(isodow from v_now) > 5 or extract(hour from v_now) < 8 or extract(hour from v_now) >= 18 then
    return 0;
  end if;
  for x in
    select c.id, c.number, c.title, c.due_date, b.name as board_name, b.whatsapp_reminder_days as dias,
           g.user_id, l.last_at
      from card c
      join board b on b.id = c.board_id and b.whatsapp_enabled and b.whatsapp_reminder_days > 0 and b.archived_at is null
      join stage s on s.id = c.stage_id and s.category <> 'done'
      join assignment g on g.card_id = c.id and g.stage_id is null
      cross join lateral (
        select greatest(c.stage_entered_at,
                        (select max(a.created_at) from activity a where a.card_id = c.id),
                        (select max(m.created_at) from comment m where m.card_id = c.id)) as last_at) l
     where c.archived_at is null
       and c.stage_id <> (select s1.id from stage s1 where s1.board_id = b.id order by s1.position limit 1)
       and l.last_at < now() - make_interval(days => b.whatsapp_reminder_days)
       and not exists (select 1 from whatsapp_outbox o
                        where o.card_id = c.id and o.kind = 'reminder'
                          and o.created_at > now() - make_interval(days => b.whatsapp_reminder_days))
     limit 50
  loop
    perform public.whatsapp_enqueue(x.user_id, x.id, 'reminder',
      format('Lembrete: o pedido #%s «%s» (%s) está há %s dias sem atualização.',
             x.number, left(x.title, 80), x.board_name, floor(extract(epoch from now() - x.last_at) / 86400)::int)
      || case when x.due_date < (v_now)::date
              then format(' O prazo era %s.', to_char(x.due_date, 'DD/MM')) else '' end
      || format(' Responda aqui com a novidade (ex.: "pedido %s: peça encomendada, chega sexta") que eu registro no card.', x.number));
    n := n + 1;
  end loop;
  return n;
end$$;

-- ── Entrada: conta as respostas a quem não está cadastrado ──────────────────
create or replace function public.whatsapp_inbound(
  p_phone text, p_phones text[], p_provider_id text, p_kind text, p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_new integer;
  v_recent integer;
  v_last timestamptz;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' or coalesce(p_provider_id, '') = '' then
    raise exception 'argumentos inválidos';
  end if;

  select a.id, a.name, a.email, a.organization_id into u
    from user_phone p join app_user a on a.id = p.user_id
   where p.phone = any (p_phones || p_phone)
     and a.archived_at is null and a.is_internal
   limit 1;

  insert into whatsapp_message (organization_id, user_id, phone, direction, kind, body, provider_id)
  values (u.organization_id, u.id, p_phone, 'in',
          case when p_kind in ('text', 'audio', 'other') then p_kind else 'other' end,
          case when u.id is null then '' else left(coalesce(p_body, ''), 4000) end,
          p_provider_id)
  on conflict (provider_id) where provider_id is not null do nothing;
  get diagnostics v_new = row_count;

  select count(*) into v_recent from whatsapp_message
   where phone = p_phone and direction = 'in' and created_at > now() - interval '1 hour';
  select max(created_at) into v_last from whatsapp_message
   where phone = p_phone and direction = 'out' and error is null;

  -- Faxina: nada fica mais de 90 dias.
  delete from whatsapp_message where created_at < now() - interval '90 days';

  return jsonb_build_object(
    'duplicada', v_new = 0,
    'usuario', case when u.id is null then null
                    else jsonb_build_object('id', u.id, 'nome', coalesce(nullif(u.name, ''), u.email)) end,
    'recentes', v_recent,
    -- Respostas já dadas a este número enquanto NÃO cadastrado (limite de 3).
    'respostas_sem_cadastro', (select count(*) from whatsapp_message
                                where phone = p_phone and direction = 'out' and user_id is null and error is null),
    'minutos_desde_resposta', case when v_last is null then null
                                   else floor(extract(epoch from now() - v_last) / 60)::integer end);
end$$;


-- ── Porta do agente: liberação e atualização por mensagem ───────────────────
create or replace function public.whatsapp_agent(p_user uuid, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  args    jsonb := coalesce(p_args, '{}'::jsonb);
  u       record;
  b       record;
  c       record;
  f       record;
  v_board uuid;
  v_stage uuid;
  v_pos   numeric;
  v_card  uuid;
  v_num   bigint;
  v_title text;
  v_val   text;
  v_opt   text;
  v_missing text[] := '{}';
  v_esc   text;
  v_num2  bigint;
  v_user  uuid;
begin
  select id, organization_id, name, email into u
    from app_user where id = p_user and archived_at is null and is_internal;
  if u.id is null then
    return jsonb_build_object('erro', 'Pessoa não encontrada.');
  end if;

  -- A partir daqui tudo roda como a pessoa (mesmas regras das telas).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u.id::text, 'role', 'authenticated')::text, true);

  -- ── contexto: pipelines atendidos e a conversa recente ─────────────────────
  if p_tool = 'contexto' then
    return jsonb_build_object(
      'pessoa', coalesce(nullif(u.name, ''), u.email),
      'hoje', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      'pipelines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', bd.id, 'nome', bd.name, 'instrucoes', bd.whatsapp_instructions,
                 'voce_gerencia', public.has_permission('stage:manage') and public.can_see_board(bd.id),
                 'exige_liberacao', bd.release_required,
                 'campos', coalesce((
                   select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                            'nome', fd.name, 'tipo', fd.type, 'obrigatorio', fd.is_required,
                            'opcoes', case when fd.type in ('select', 'status') then (
                              select jsonb_agg(o->>'label') from jsonb_array_elements(
                                coalesce(fd.config->'options', '[]'::jsonb)) o) end))
                          order by fd.position)
                     from field_definition fd
                    where fd.board_id = bd.id and fd.archived_at is null and fd.show_on_create
                      and fd.type in ('text', 'number', 'select', 'status', 'link')), '[]'::jsonb))
               order by bd.name)
          from board bd
         where bd.organization_id = u.organization_id and bd.archived_at is null
           and bd.whatsapp_enabled and public.has_permission('card:create')
           and (public.can_see_board(bd.id) or bd.intake = 'org')), '[]'::jsonb),
      'conversa', coalesce((
        select jsonb_agg(jsonb_build_object('de', case m.direction when 'in' then 'pessoa' else 'agente' end,
                                            'texto', m.body) order by m.created_at)
          from (select direction, body, created_at from whatsapp_message
                 where user_id = u.id and body <> '' and error is null
                   and created_at > now() - interval '12 hours'
                 order by created_at desc limit 20) m), '[]'::jsonb));
  end if;

  -- ── situacao_pedido: só cards que a pessoa enxerga ─────────────────────────
  if p_tool = 'situacao_pedido' then
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    if v_num is null then return jsonb_build_object('erro', 'Informe o número do pedido.'); end if;
    return jsonb_build_object('pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'numero', k.number, 'titulo', k.title, 'pipeline', bd.name, 'etapa', s.name,
               'concluido', s.category = 'done', 'arquivado', k.archived_at is not null,
               'prazo', to_char(k.due_date, 'DD/MM/YYYY'),
               'responsavel', (select coalesce(nullif(a.name, ''), a.email) from assignment g
                                 join app_user a on a.id = g.user_id
                                where g.card_id = k.id and g.stage_id is null limit 1),
               'aberto_em', to_char(k.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
               'na_etapa_desde', to_char(k.stage_entered_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
               'ultimo_comentario', (select left(m.body, 300) from comment m
                                      where m.card_id = k.id and m.archived_at is null
                                      order by m.created_at desc limit 1)))
        from card k join board bd on bd.id = k.board_id join stage s on s.id = k.stage_id
       where k.organization_id = u.organization_id and k.number = v_num
         and (args->>'pipeline_id' is null or k.board_id::text = args->>'pipeline_id')
         and public.can_see_card(k.id)), '[]'::jsonb));
  end if;

  -- ── comentar_pedido: a novidade vira comentário no card ───────────────────
  if p_tool = 'comentar_pedido' then
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    if v_num is null then return jsonb_build_object('erro', 'Informe o número do pedido.'); end if;
    if nullif(trim(coalesce(args->>'texto', '')), '') is null then
      return jsonb_build_object('erro', 'Falta o texto da atualização.');
    end if;
    if not public.has_permission('comment:create') then
      return jsonb_build_object('erro', 'Você não tem permissão para comentar.');
    end if;
    select count(*), min(k.id::text)::uuid into v_num2, v_card
      from card k
     where k.organization_id = u.organization_id and k.number = v_num and k.archived_at is null
       and (nullif(args->>'pipeline_id', '') is null or k.board_id::text = args->>'pipeline_id')
       and public.can_see_card(k.id);
    if v_num2 = 0 then return jsonb_build_object('erro', 'Não achei esse pedido, ou você não tem acesso a ele.'); end if;
    if v_num2 > 1 then
      return jsonb_build_object('erro', 'Há mais de um pedido com esse número. Pergunte de qual pipeline é.',
        'pipelines', (select jsonb_agg(jsonb_build_object('pipeline_id', bd.id, 'nome', bd.name))
                        from card k join board bd on bd.id = k.board_id
                       where k.organization_id = u.organization_id and k.number = v_num
                         and k.archived_at is null and public.can_see_card(k.id)));
    end if;
    insert into comment (organization_id, card_id, author_id, body)
    values (u.organization_id, v_card, u.id, 'Pelo WhatsApp: ' || left(trim(args->>'texto'), 2000));
    return jsonb_build_object('ok', true, 'numero', v_num);
  end if;

  -- As demais ferramentas valem para UM pipeline atendido em que a pessoa pode pedir.
  begin
    v_board := (args->>'pipeline_id')::uuid;
  exception when others then
    return jsonb_build_object('erro', 'pipeline_id inválido. Use um id da lista de pipelines.');
  end;
  select bd.* into b from board bd
   where bd.id = v_board and bd.organization_id = u.organization_id and bd.archived_at is null
     and bd.whatsapp_enabled and public.has_permission('card:create')
     and (public.can_see_board(bd.id) or bd.intake = 'org');
  if b.id is null then
    return jsonb_build_object('erro', 'Este pipeline não atende pelo WhatsApp ou você não pode abrir pedidos nele.');
  end if;

  -- ── preparar_liberacao: confere e escolhe o responsável ───────────────────
  -- NÃO move o card: quem move é o site (CardService.move), chamado pelo Worker
  -- com o que sai daqui.
  if p_tool = 'preparar_liberacao' then
    if not (public.has_permission('stage:manage') and public.can_see_board(b.id)) then
      return jsonb_build_object('erro', 'Só a gestão deste pipeline pode liberar pedidos.');
    end if;
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    select k.id, k.number, k.title, k.stage_id, s.name as stage_name into c
      from card k join stage s on s.id = k.stage_id
     where k.board_id = b.id and k.number = v_num and k.archived_at is null;
    if c.id is null then return jsonb_build_object('erro', 'Não achei esse pedido neste pipeline.'); end if;
    select s.id into v_stage from stage s where s.board_id = b.id order by s.position limit 1;
    if c.stage_id <> v_stage then
      return jsonb_build_object('erro', format('O pedido #%s já foi liberado (está em "%s").', c.number, c.stage_name));
    end if;

    v_val := nullif(trim(coalesce(args->>'responsavel', '')), '');
    if v_val is not null then
      -- O gestor indicou alguém: vale qualquer pessoa interna da equipe do pipeline.
      select count(*), min(a.id::text)::uuid into v_num2, v_user
        from board_member bm join app_user a on a.id = bm.user_id
       where bm.board_id = b.id and a.is_internal and a.archived_at is null
         and (a.name ilike '%' || v_val || '%' or a.email ilike v_val || '%');
      if v_num2 <> 1 then
        return jsonb_build_object(
          'erro', case when v_num2 = 0 then format('Não achei "%s" na equipe deste pipeline.', v_val)
                       else format('Mais de uma pessoa combina com "%s". Peça o nome completo.', v_val) end,
          'equipe', (select jsonb_agg(coalesce(nullif(a.name, ''), a.email) order by a.name)
                       from board_member bm join app_user a on a.id = bm.user_id
                      where bm.board_id = b.id and a.is_internal and a.archived_at is null));
      end if;
    else
      -- Sem indicação: os "membros internos" do pipeline (quem executa).
      select count(*), min(a.id::text)::uuid into v_num2, v_user
        from board_member bm join app_user a on a.id = bm.user_id
       where bm.board_id = b.id and a.is_internal and a.archived_at is null
         and exists (select 1 from user_role ur join role ro on ro.id = ur.role_id
                      where ur.user_id = a.id and ro.slug = 'interno');
      if v_num2 > 1 then
        return jsonb_build_object(
          'erro', 'Há mais de uma pessoa na equipe deste pipeline. Pergunte ao gestor com quem fica o pedido e chame de novo com o nome.',
          'equipe', (select jsonb_agg(coalesce(nullif(a.name, ''), a.email) order by a.name)
                       from board_member bm join app_user a on a.id = bm.user_id
                      where bm.board_id = b.id and a.is_internal and a.archived_at is null
                        and exists (select 1 from user_role ur join role ro on ro.id = ur.role_id
                                     where ur.user_id = a.id and ro.slug = 'interno')));
      end if;
      if v_num2 = 0 then v_user := null; end if;
    end if;

    return jsonb_build_object('ok', true, 'card_id', c.id, 'numero', c.number, 'titulo', c.title,
      'assignee_id', v_user,
      'responsavel', (select coalesce(nullif(a.name, ''), a.email) from app_user a where a.id = v_user));
  end if;

  -- ── buscar_pedidos: abertos do pipeline, para não duplicar ─────────────────
  -- Devolve o mínimo (número, título, etapa, campos de opção/texto curto), mesmo
  -- de cards que a pessoa não abre na tela: é o que permite achar o repetido.
  if p_tool = 'buscar_pedidos' then
    return jsonb_build_object('abertos', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select k.created_at, jsonb_build_object(
                 'numero', k.number, 'titulo', k.title, 'etapa', s.name,
                 'aberto_em', to_char(k.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                 'campos', coalesce((
                   select jsonb_object_agg(fd.name, coalesce(
                            (select o->>'label' from jsonb_array_elements(coalesce(fd.config->'options', '[]'::jsonb)) o
                              where o->>'id' = fv.value_text limit 1),
                            left(fv.value_text, 80), fv.value_number::text))
                     from field_value fv join field_definition fd on fd.id = fv.field_definition_id
                    where fv.card_id = k.id and fd.show_on_create
                      and fd.type in ('text', 'number', 'select', 'status')), '{}'::jsonb)) as j
          from card k join stage s on s.id = k.stage_id
         where k.board_id = b.id and k.archived_at is null and s.category <> 'done'
           and (coalesce(args->>'texto', '') = ''
                or k.title ilike '%' || (args->>'texto') || '%'
                or exists (select 1 from field_value fv where fv.card_id = k.id
                            and fv.value_text ilike '%' || (args->>'texto') || '%'))
         order by k.created_at desc limit 40) x), '[]'::jsonb));
  end if;

  -- ── reforcar_pedido: registra o novo pedido num card que já existe ─────────
  if p_tool = 'reforcar_pedido' then
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    select k.id, k.number into c from card k join stage s on s.id = k.stage_id
     where k.board_id = b.id and k.number = v_num and k.archived_at is null and s.category <> 'done';
    if c.id is null then return jsonb_build_object('erro', 'Não achei pedido aberto com esse número neste pipeline.'); end if;
    insert into comment (organization_id, card_id, author_id, body)
    values (b.organization_id, c.id, u.id,
            format('Novo pedido pelo WhatsApp em %s: %s',
                   to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM'),
                   left(coalesce(nullif(trim(args->>'texto'), ''), 'mesmo problema'), 1000)));
    return jsonb_build_object('ok', true, 'numero', c.number);
  end if;

  -- ── criar_pedido ───────────────────────────────────────────────────────────
  if p_tool = 'criar_pedido' then
    v_title := left(trim(coalesce(args->>'titulo', '')), 200);
    if v_title = '' then return jsonb_build_object('erro', 'Falta o título do pedido.'); end if;

    -- Confere os campos antes de gravar qualquer coisa.
    for f in select fd.* from field_definition fd
              where fd.board_id = b.id and fd.archived_at is null and fd.show_on_create
                and fd.type in ('text', 'number', 'select', 'status', 'link') loop
      v_val := nullif(trim(coalesce(args->'campos'->>f.name, '')), '');
      if v_val is null then
        if f.is_required then v_missing := array_append(v_missing, f.name); end if;
      elsif f.type in ('select', 'status') and not exists (
              select 1 from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
               where lower(o->>'label') = lower(v_val)) then
        return jsonb_build_object('erro', format('"%s" não é uma opção de "%s".', v_val, f.name));
      elsif f.type = 'number' and v_val !~ '^-?[0-9]+([.,][0-9]+)?$' then
        return jsonb_build_object('erro', format('"%s" precisa ser um número.', f.name));
      end if;
    end loop;
    if array_length(v_missing, 1) > 0 then
      return jsonb_build_object('erro', 'Faltam campos obrigatórios: ' || array_to_string(v_missing, ', ') || '. Pergunte à pessoa.');
    end if;

    select s.id into v_stage from stage s where s.board_id = b.id order by s.position limit 1;
    if v_stage is null then return jsonb_build_object('erro', 'O pipeline não tem etapas.'); end if;
    select coalesce(max(k.position), 0) + 1000 into v_pos from card k where k.stage_id = v_stage;

    v_esc := replace(replace(replace(left(coalesce(args->>'descricao', ''), 4000), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    insert into card (organization_id, board_id, stage_id, title, position, requester_id, description)
    values (b.organization_id, b.id, v_stage, v_title, v_pos, u.id,
            case when v_esc = '' then '' else '<p>' || replace(v_esc, E'\n', '<br>') || '</p>' end
            || '<p><em>Pedido aberto pelo WhatsApp.</em></p>')
    returning id, number into v_card, v_num;

    for f in select fd.* from field_definition fd
              where fd.board_id = b.id and fd.archived_at is null and fd.show_on_create
                and fd.type in ('text', 'number', 'select', 'status', 'link') loop
      v_val := nullif(trim(coalesce(args->'campos'->>f.name, '')), '');
      continue when v_val is null;
      if f.type in ('select', 'status') then
        select o->>'id' into v_opt from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
         where lower(o->>'label') = lower(v_val) limit 1;
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values (f.id, v_card, b.organization_id, v_opt);
      elsif f.type = 'number' then
        insert into field_value (field_definition_id, card_id, organization_id, value_number)
        values (f.id, v_card, b.organization_id, replace(v_val, ',', '.')::numeric);
      else
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values (f.id, v_card, b.organization_id, left(v_val, 500));
      end if;
    end loop;

    insert into activity (organization_id, card_id, actor_id, kind, payload)
    values (b.organization_id, v_card, u.id, 'card_created',
            jsonb_build_object('stageId', v_stage, 'via', 'whatsapp'));
    return jsonb_build_object('ok', true, 'numero', v_num, 'id', v_card);
  end if;

  return jsonb_build_object('erro', 'Ferramenta desconhecida.');
end$$;


do $$
declare f text;
begin
  foreach f in array array[
    'public.whatsapp_enqueue(uuid, uuid, text, text)',
    'public.whatsapp_notify_activity()',
    'public.whatsapp_outbox_take(integer)',
    'public.whatsapp_outbox_done(uuid, text)',
    'public.whatsapp_enqueue_reminders()',
    'public.whatsapp_inbound(text, text[], text, text, text)',
    'public.whatsapp_agent(uuid, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
