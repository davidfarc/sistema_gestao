-- ============================================================================
-- 0050_whatsapp_agent.sql — Agente do WhatsApp (SPEC-FASE2 §C, etapa C2)
--
-- 1. `board.whatsapp_enabled` e `board.whatsapp_instructions`: a gestão liga o
--    atendimento por pipeline e escreve o que o agente precisa saber (salas,
--    que tipo de pedido cabe ali).
-- 2. `whatsapp_agent(usuário, ferramenta, argumentos)`: a única porta do agente
--    para o banco. Roda COM A IDENTIDADE DA PESSOA que escreveu: confere a
--    permissão de criar card, o acesso ao pipeline (membro, ou pipeline com
--    caixa de entrada aberta) e a visibilidade do card, pelas mesmas funções
--    que protegem as telas. Só aceita a chave de servidor.
--
-- O agente NÃO move card, não apaga nada e não mexe em configuração.
-- Só cria colunas e a função. Idempotente.
-- ============================================================================

alter table board add column if not exists whatsapp_enabled      boolean not null default false;
alter table board add column if not exists whatsapp_instructions text    not null default '';

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
                   and created_at > now() - interval '3 hours'
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

revoke all on function public.whatsapp_agent(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_agent(uuid, text, jsonb) to service_role;
