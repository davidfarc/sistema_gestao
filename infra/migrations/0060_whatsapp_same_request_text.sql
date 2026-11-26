-- ============================================================================
-- 0060_whatsapp_same_request_text.sql — pedido repetido escrito de outro jeito
--
-- Caso real (26/11, Demanda TI #4 e #5): duas pessoas pediram a mesma coisa e
-- o Luix abriu dois cards. Em campo de TEXTO LIVRE a comparação era literal:
-- "sala dos professores" e "sala prof." eram tratados como pedidos diferentes,
-- e a ferramenta mandava abrir um novo. Agora:
--   - em campo de texto livre com grafia diferente, `reforcar_pedido` devolve
--     `confirmar` (a pessoa decide se é o mesmo) em vez de recusar;
--   - campos de opções e números continuam exigindo valor igual;
--   - `buscar_pedidos` traz um trecho da descrição, para comparar o problema.
--
-- Só troca a função `whatsapp_agent` (mesma assinatura). Idempotente.
-- ============================================================================

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
  v_same  jsonb;
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
      -- Fotos que a pessoa mandou na última hora e ainda não foram para nenhum card.
      'imagens_pendentes', (select count(*) from whatsapp_media wm
                             where wm.user_id = u.id and wm.card_id is null
                               and wm.created_at > now() - interval '1 hour'),
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

  -- ── anexar_imagens: as fotos pendentes da pessoa vão para um card ─────────
  if p_tool = 'anexar_imagens' then
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    if v_num is null then return jsonb_build_object('erro', 'Informe o número do pedido.'); end if;
    if not exists (select 1 from whatsapp_media wm where wm.user_id = u.id and wm.card_id is null
                    and wm.created_at > now() - interval '1 hour') then
      return jsonb_build_object('erro', 'Não há foto recente desta pessoa para anexar. Peça para ela enviar a foto.');
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
    -- Quem pode: quem edita cards, quem pediu este ou quem é o responsável por ele.
    if not (public.has_permission('card:update')
            or exists (select 1 from card k where k.id = v_card and k.requester_id = u.id)
            or exists (select 1 from assignment g where g.card_id = v_card and g.user_id = u.id)) then
      return jsonb_build_object('erro', 'Você não pode anexar a este pedido: só quem pediu, o responsável ou a gestão.');
    end if;
    v_num2 := public.whatsapp_attach_media(u.id, v_card, args->>'legenda');
    return jsonb_build_object('ok', true, 'numero', v_num, 'imagens_anexadas', v_num2);
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
                 'descricao', left(trim(regexp_replace(regexp_replace(coalesce(k.description, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 160),
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

    -- Só é "o mesmo pedido" se os campos obrigatórios batem. O agente tem de
    -- tê-los perguntado antes (sala 12 da Vila 1 não é a sala 12 da Vila 2).
    for f in select fd.* from field_definition fd
              where fd.board_id = b.id and fd.archived_at is null and fd.show_on_create and fd.is_required
                and fd.type in ('text', 'number', 'select', 'status', 'link') order by fd.position loop
      v_val := nullif(trim(coalesce(args->'campos'->>f.name, '')), '');
      if v_val is null then
        v_missing := array_append(v_missing, f.name);
        continue;
      end if;
      -- Valor do card existente, já como texto legível (rótulo da opção, quando for de opções).
      select coalesce(
               (select o->>'label' from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
                 where o->>'id' = fv.value_text limit 1),
               fv.value_text, trim(trailing '.' from trim(trailing '0' from fv.value_number::text)))
        into v_opt
        from field_value fv where fv.card_id = c.id and fv.field_definition_id = f.id;
      -- Card antigo sem esse campo preenchido: não há como comparar, não bloqueia.
      if v_opt is not null and lower(trim(v_opt)) <> lower(replace(v_val, ',', '.'))
         and lower(trim(v_opt)) <> lower(v_val) then
        -- Texto livre escrito de outro jeito ("sala dos professores" x "sala prof.")
        -- pode ser o mesmo lugar: quem decide é a pessoa, não a grafia.
        if f.type in ('text', 'link') then
          if coalesce((args->>'confirmado_pela_pessoa')::boolean, false) is not true then
            return jsonb_build_object('confirmar', format(
              'No pedido #%s, "%s" está escrito "%s", e a pessoa informou "%s". Pergunte à pessoa se é o mesmo (1 - Sim, é o mesmo pedido; 2 - Não, é outro). Se ela disser 1, chame de novo com confirmado_pela_pessoa = true; se disser 2, abra um pedido novo.',
              c.number, f.name, v_opt, v_val));
          end if;
        else
          return jsonb_build_object('erro', format(
            'O pedido #%s não é o mesmo: nele "%s" é "%s", e a pessoa informou "%s". Não reforce este. Veja se outro pedido aberto bate em todos os campos; se nenhum bater, abra um pedido novo.',
            c.number, f.name, v_opt, v_val));
        end if;
      end if;
    end loop;
    if array_length(v_missing, 1) > 0 then
      return jsonb_build_object('erro', 'Antes de reforçar, pergunte à pessoa: ' || array_to_string(v_missing, ', ')
        || '. Só é o mesmo pedido se esses campos forem iguais aos do pedido existente.');
    end if;

    -- Há OUTROS pedidos abertos com os mesmos campos obrigatórios? Então quem
    -- escolhe é a pessoa, não o agente (podem existir duplicados antigos).
    if coalesce((args->>'confirmado_pela_pessoa')::boolean, false) is not true then
      select jsonb_agg(jsonb_build_object('numero', k.number, 'titulo', k.title, 'etapa', s.name,
               'aberto_em', to_char(k.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')) order by k.created_at)
        into v_same
        from card k join stage s on s.id = k.stage_id
       where k.board_id = b.id and k.archived_at is null and s.category <> 'done'
         and exists (select 1 from field_definition fd
                      where fd.board_id = b.id and fd.archived_at is null and fd.show_on_create and fd.is_required
                        and fd.type in ('text', 'number', 'select', 'status', 'link'))
         and not exists (
           select 1 from field_definition fd
            where fd.board_id = b.id and fd.archived_at is null and fd.show_on_create and fd.is_required
              and fd.type in ('text', 'number', 'select', 'status', 'link')
              and not exists (
                select 1 from field_value fv
                 where fv.card_id = k.id and fv.field_definition_id = fd.id
                   and lower(trim(coalesce(
                         (select o->>'label' from jsonb_array_elements(coalesce(fd.config->'options', '[]'::jsonb)) o
                           where o->>'id' = fv.value_text limit 1),
                         fv.value_text, trim(trailing '.' from trim(trailing '0' from fv.value_number::text)))))
                       in (lower(trim(args->'campos'->>fd.name)), lower(replace(trim(args->'campos'->>fd.name), ',', '.')))));
      if jsonb_array_length(coalesce(v_same, '[]'::jsonb)) > 1 then
        return jsonb_build_object(
          'erro', 'Há mais de um pedido aberto com esses mesmos campos. Não escolha sozinho: liste todos à pessoa (número, título e data) e pergunte em qual registrar. Depois chame de novo com o número escolhido e confirmado_pela_pessoa = true.',
          'pedidos_iguais', v_same);
      end if;
    end if;

    v_val := left(coalesce(nullif(trim(args->>'texto'), ''), 'mesmo problema'), 1000);
    v_title := coalesce(nullif(u.name, ''), u.email);
    -- Comentário com o nome de quem reforçou (o solicitante original não muda).
    insert into comment (organization_id, card_id, author_id, body)
    values (b.organization_id, c.id, u.id,
            format('Reforço do pedido pelo WhatsApp em %s, por %s: %s',
                   to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM'), v_title, v_val));
    -- E o mesmo texto ao fim da descrição, para quem abre o card ver de imediato.
    v_esc := replace(replace(replace(v_val, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    update card
       set description = coalesce(description, '') || format('<p><em>Reforço em %s, por %s:</em> %s</p>',
             to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM'),
             replace(replace(replace(v_title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
             replace(v_esc, E'\n', '<br>'))
     where id = c.id;
    -- Fotos enviadas junto do reforço vão para o mesmo card.
    v_num2 := public.whatsapp_attach_media(u.id, c.id, 'Evidência (reforço)');
    return jsonb_build_object('ok', true, 'numero', c.number, 'imagens_anexadas', v_num2);
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
    -- Fotos que a pessoa mandou junto do pedido já nascem anexadas a ele.
    v_num2 := public.whatsapp_attach_media(u.id, v_card, 'Evidência');
    return jsonb_build_object('ok', true, 'numero', v_num, 'id', v_card, 'imagens_anexadas', v_num2);
  end if;

  return jsonb_build_object('erro', 'Ferramenta desconhecida.');
end$$;

revoke all on function public.whatsapp_agent(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_agent(uuid, text, jsonb) to service_role;
