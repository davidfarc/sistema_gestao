-- ============================================================================
-- Importação do sistema antigo "Produção Pedagógica" — PASSO 2: importar
-- (SPEC-FASE2 §E.12)
--
-- Lê as tabelas de passagem (passo 1) e cria os cards no pipeline indicado.
--
--   select public.import_producao_pedagogica('Editora Pedagógico', 'e-mail de quem assina', false);
--     → SIMULA: devolve o resumo e NÃO grava nada.
--   select public.import_producao_pedagogica('Editora Pedagógico', 'e-mail de quem assina', true);
--     → GRAVA. Rodar de novo não duplica (o que já entrou é pulado).
--
-- Conversão:
--   material                     → card (nome → título; criado_em → data de criação)
--   prazo                        → prazo do card
--   membro_email                 → responsável (usuário com o mesmo e-mail)
--   status + parecer             → etapa: aprovado → concluída; emenda → etapa de
--                                  emenda; entregue (ou reentregue) → revisão;
--                                  o resto → em andamento
--   emendas                      → emendas do card
--   segmento, tipo, início, fim, link do autor → propriedades de mesmo nome
--                                  (o início também aceita "Data inicial"; o fim, "Data final")
--                                  (opção que não existe é acrescentada)
--   comentários do parecer       → comentários, assinados pelo e-mail informado
--   histórico                    → histórico do card
--   diário do responsável, nos dias entre o início e o fim do material
--                                → texto corrido na descrição do card
--
-- A função só roda pelo SQL Editor (sem acesso pela API). Não contém dados.
-- ============================================================================

create or replace function public.import_producao_pedagogica(
  p_board  text,
  p_author text,
  p_apply  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b          board%rowtype;
  v_author   uuid;
  s_prod     uuid;
  s_analise  uuid;
  s_emenda   uuid;
  s_aprov    uuid;
  f_seg      field_definition%rowtype;
  f_tipo     field_definition%rowtype;
  f_inicio   uuid;
  f_fim      uuid;
  f_link     uuid;
  m          record;
  v_user     uuid;
  v_stage    uuid;
  v_card     uuid;
  v_desc     text;
  v_opt      text;
  v_n        int;
  v_sit      text;
  v_entregue boolean;
  v_reentregue boolean;
  v_pos      numeric := 0;
  n_criados  int := 0;
  n_pulados  int := 0;
  n_coment   int := 0;
  n_hist     int := 0;
  n_diario   int := 0;
  por_etapa  jsonb := '{}'::jsonb;
  sem_usuario text[] := '{}';
  opcoes_novas text[] := '{}';
  avisos     text[] := '{}';
  resumo     jsonb;
begin
  -- ── Destino ────────────────────────────────────────────────────────────────
  select * into b from board
   where lower(trim(name)) = lower(trim(p_board)) and archived_at is null;
  if not found then raise exception 'Pipeline "%" não encontrado.', p_board; end if;

  select id into v_author from app_user
   where organization_id = b.organization_id and lower(email) = lower(trim(p_author));
  if v_author is null then
    raise exception 'Usuário "%" não encontrado: informe o e-mail de quem vai assinar os comentários importados.', p_author;
  end if;

  select id into s_emenda from stage where board_id = b.id and counts_rework order by position limit 1;
  if s_emenda is null then
    select id into s_emenda from stage where board_id = b.id and name ilike '%emenda%' order by position limit 1;
  end if;
  select id into s_prod from stage
   where board_id = b.id and category in ('in_progress', 'backlog') and id is distinct from s_emenda
   order by (category = 'in_progress') desc, position limit 1;
  select id into s_analise from stage where board_id = b.id and category = 'review' order by position limit 1;
  select id into s_aprov   from stage where board_id = b.id and category = 'done'   order by position limit 1;
  if s_prod is null or s_analise is null or s_emenda is null or s_aprov is null then
    raise exception 'O pipeline precisa de quatro etapas: uma em andamento (%), uma de revisão (%), uma de emenda (%) e uma concluída (%). "falta" = não encontrada.',
      coalesce((select name from stage where id = s_prod), 'falta'),
      coalesce((select name from stage where id = s_analise), 'falta'),
      coalesce((select name from stage where id = s_emenda), 'falta'),
      coalesce((select name from stage where id = s_aprov), 'falta');
  end if;

  -- ── Propriedades (pelo nome, sem acento nem maiúsculas) ─────────────────────
  select * into f_seg from field_definition
   where board_id = b.id and archived_at is null and type in ('select', 'status')
     and lower(translate(name, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) = 'segmento' limit 1;
  select * into f_tipo from field_definition
   where board_id = b.id and archived_at is null and type in ('select', 'status')
     and lower(translate(name, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) in ('tipo de material', 'tipo') limit 1;
  select id into f_inicio from field_definition
   where board_id = b.id and archived_at is null and type = 'date'
     and lower(translate(name, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) in ('inicio', 'data inicial', 'data de inicio') limit 1;
  select id into f_fim from field_definition
   where board_id = b.id and archived_at is null and type = 'date'
     and lower(translate(name, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) in ('finalizacao', 'fim', 'data final', 'data de finalizacao') limit 1;
  select id into f_link from field_definition
   where board_id = b.id and archived_at is null and type in ('link', 'text')
     and lower(translate(name, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) = 'link do autor' limit 1;
  if f_seg.id  is null then avisos := array_append(avisos, 'Propriedade "Segmento" (de opções) não existe no pipeline: o segmento não será importado.'::text); end if;
  if f_tipo.id is null then avisos := array_append(avisos, 'Propriedade "Tipo de material" (de opções) não existe no pipeline: o tipo não será importado.'::text); end if;
  if f_inicio  is null then avisos := array_append(avisos, 'Propriedade de data "Início" (ou "Data inicial") não existe no pipeline: o início não será importado.'::text); end if;
  if f_fim     is null then avisos := array_append(avisos, 'Propriedade de data "Finalização" (ou "Data final") não existe no pipeline: a finalização não será importada.'::text); end if;
  if f_link    is null then avisos := array_append(avisos, 'Propriedade "Link do autor" não existe no pipeline: o link não será importado.'::text); end if;

  select coalesce(max(position), 0) into v_pos from card where board_id = b.id;

  -- ── Materiais ───────────────────────────────────────────────────────────────
  begin
    for m in
      select mt.*,
             nullif(trim(mt.prazo), '')::date          as d_prazo,
             nullif(trim(mt.inicio), '')::date         as d_inicio,
             nullif(trim(mt.fim), '')::date            as d_fim,
             nullif(trim(mt.entrega_em), '')::timestamptz   as t_entrega,
             coalesce(nullif(trim(mt.criado_em), '')::timestamptz, now())     as t_criado,
             coalesce(nullif(trim(mt.atualizado_em), '')::timestamptz, now()) as t_atualizado,
             coalesce(nullif(trim(mt.historico), ''), '[]')::jsonb            as j_hist,
             p.situacao                                                       as p_situacao,
             coalesce(nullif(trim(p.emendas), '')::int, 0)                    as p_emendas,
             coalesce(nullif(trim(p.comentarios), ''), '[]')::jsonb           as j_coment,
             nullif(trim(p.atualizado_em), '')::timestamptz                   as p_atualizado
        from import_pp_materiais mt
        left join import_pp_pareceres p on p.material_id = mt.id
       order by nullif(trim(mt.criado_em), '')::timestamptz nulls last, mt.id
    loop
      if exists (select 1 from import_pp_feito f where f.material_id = m.id) then
        n_pulados := n_pulados + 1;
        continue;
      end if;

      -- Etapa, pela mesma regra de tela do sistema antigo.
      v_entregue   := m.status = 'entregue';
      v_reentregue := m.p_situacao = 'emenda' and v_entregue
                      and m.t_entrega is not null and m.p_atualizado is not null
                      and m.t_entrega > m.p_atualizado;
      v_sit := case
        when m.p_situacao = 'aprovado' then 'aprovado'
        when m.p_situacao = 'emenda' and not v_reentregue then 'emenda'
        when v_entregue then 'analise'
        else 'producao' end;
      v_stage := case v_sit when 'aprovado' then s_aprov when 'emenda' then s_emenda
                            when 'analise' then s_analise else s_prod end;
      por_etapa := jsonb_set(por_etapa, array[(select name from stage where id = v_stage)],
                             to_jsonb(coalesce((por_etapa ->> (select name from stage where id = v_stage))::int, 0) + 1));

      select id into v_user from app_user
       where organization_id = b.organization_id and lower(email) = lower(trim(m.membro_email));
      if v_user is null and not (lower(trim(m.membro_email)) = any (sem_usuario)) then
        sem_usuario := array_append(sem_usuario, lower(trim(m.membro_email)));
      end if;

      -- Diário do responsável nos dias do material, como texto corrido.
      select string_agg(
               '<p><strong>' || to_char(d.dia::date, 'DD/MM/YYYY') || ':</strong> '
               || replace(replace(replace(replace(d.texto, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>')
               || '</p>', '' order by d.dia::date),
             count(*)
        into v_desc, v_n
        from import_pp_diario d
       where lower(trim(d.membro_email)) = lower(trim(m.membro_email))
         and trim(coalesce(d.texto, '')) <> ''
         and m.d_inicio is not null
         and d.dia::date between m.d_inicio and coalesce(m.d_fim, m.t_entrega::date, current_date);
      n_diario := n_diario + coalesce(v_n, 0);
      if v_desc is not null then
        v_desc := '<p><strong>Diário de produção (importado do sistema antigo)</strong></p>' || v_desc;
      end if;

      v_pos := v_pos + 1000;
      insert into card (organization_id, board_id, stage_id, title, description, due_date, position,
                        created_at, updated_at, stage_entered_at, completed_at, rework_count)
      values (b.organization_id, b.id, v_stage, coalesce(nullif(trim(m.nome), ''), 'Material sem nome'), v_desc,
              m.d_prazo, v_pos, m.t_criado, m.t_atualizado,
              coalesce(m.p_atualizado, m.t_entrega, m.t_atualizado),
              case when v_sit = 'aprovado' then coalesce(m.p_atualizado, m.t_atualizado) end,
              m.p_emendas)
      returning id into v_card;
      insert into import_pp_feito (material_id, card_id) values (m.id, v_card);
      n_criados := n_criados + 1;

      if v_user is not null then
        insert into assignment (organization_id, card_id, user_id, stage_id)
        values (b.organization_id, v_card, v_user, null);
      end if;

      -- Segmento e tipo: opção pelo rótulo; a que não existe é acrescentada.
      if f_seg.id is not null and trim(coalesce(m.segmento, '')) <> '' then
        select o ->> 'id' into v_opt from jsonb_array_elements(coalesce(f_seg.config -> 'options', '[]'::jsonb)) o
         where lower(trim(o ->> 'label')) = lower(trim(m.segmento)) limit 1;
        if v_opt is null then
          v_opt := 'imp' || substr(md5(lower(trim(m.segmento))), 1, 8);
          f_seg.config := jsonb_set(coalesce(f_seg.config, '{}'::jsonb), '{options}',
            coalesce(f_seg.config -> 'options', '[]'::jsonb)
            || jsonb_build_object('id', v_opt, 'label', trim(m.segmento), 'color', '#64748b'));
          update field_definition set config = f_seg.config where id = f_seg.id;
          opcoes_novas := array_append(opcoes_novas, 'Segmento: ' || trim(m.segmento));
        end if;
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values (f_seg.id, v_card, b.organization_id, v_opt);
      end if;
      if f_tipo.id is not null and trim(coalesce(m.tipo, '')) <> '' then
        select o ->> 'id' into v_opt from jsonb_array_elements(coalesce(f_tipo.config -> 'options', '[]'::jsonb)) o
         where lower(trim(o ->> 'label')) = lower(trim(m.tipo)) limit 1;
        if v_opt is null then
          v_opt := 'imp' || substr(md5(lower(trim(m.tipo))), 1, 8);
          f_tipo.config := jsonb_set(coalesce(f_tipo.config, '{}'::jsonb), '{options}',
            coalesce(f_tipo.config -> 'options', '[]'::jsonb)
            || jsonb_build_object('id', v_opt, 'label', trim(m.tipo), 'color', '#64748b'));
          update field_definition set config = f_tipo.config where id = f_tipo.id;
          opcoes_novas := array_append(opcoes_novas, 'Tipo: ' || trim(m.tipo));
        end if;
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values (f_tipo.id, v_card, b.organization_id, v_opt);
      end if;
      if f_inicio is not null and m.d_inicio is not null then
        insert into field_value (field_definition_id, card_id, organization_id, value_date)
        values (f_inicio, v_card, b.organization_id, m.d_inicio);
      end if;
      if f_fim is not null and m.d_fim is not null then
        insert into field_value (field_definition_id, card_id, organization_id, value_date)
        values (f_fim, v_card, b.organization_id, m.d_fim);
      end if;
      if f_link is not null and trim(coalesce(m.link_autor, '')) <> '' then
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values (f_link, v_card, b.organization_id, trim(m.link_autor));
      end if;

      -- Comentários do parecer e histórico, com a data original.
      insert into comment (organization_id, card_id, author_id, body, created_at, updated_at)
      select b.organization_id, v_card, v_author, c ->> 'texto',
             coalesce((c ->> 'em')::timestamptz, m.t_atualizado), coalesce((c ->> 'em')::timestamptz, m.t_atualizado)
        from jsonb_array_elements(m.j_coment) c
       where trim(coalesce(c ->> 'texto', '')) <> '';
      get diagnostics v_n = row_count;
      n_coment := n_coment + v_n;

      insert into activity (organization_id, card_id, actor_id, kind, payload, created_at)
      select b.organization_id, v_card, coalesce(v_user, v_author), 'legacy_note',
             jsonb_build_object('text', h ->> 'texto'), coalesce((h ->> 'em')::timestamptz, m.t_atualizado)
        from jsonb_array_elements(m.j_hist) h
       where trim(coalesce(h ->> 'texto', '')) <> '';
      get diagnostics v_n = row_count;
      n_hist := n_hist + v_n;
    end loop;

    resumo := jsonb_build_object(
      'modo', case when p_apply then 'GRAVADO' else 'SIMULAÇÃO (nada foi gravado)' end,
      'pipeline', b.name,
      'cards_criados', n_criados,
      'ja_importados_antes', n_pulados,
      'por_etapa', por_etapa,
      'comentarios', n_coment,
      'linhas_de_historico', n_hist,
      'dias_de_diario_usados', n_diario,
      'dias_de_diario_no_arquivo', (select count(*) from import_pp_diario where trim(coalesce(texto, '')) <> ''),
      'responsaveis_sem_usuario', to_jsonb(sem_usuario),
      'opcoes_acrescentadas', to_jsonb(opcoes_novas),
      'avisos', to_jsonb(avisos));

    -- Simulação: desfaz tudo o que este bloco gravou (o resumo já está montado).
    if not p_apply then raise exception using errcode = 'P0999', message = 'simulacao'; end if;
  exception when sqlstate 'P0999' then
    null;
  end;

  return resumo;
end$$;

revoke all on function public.import_producao_pedagogica(text, text, boolean) from public, anon, authenticated;
