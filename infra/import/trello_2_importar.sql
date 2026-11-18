-- ============================================================================
-- Importação dos quadros do Trello — PASSO 2: importar (SPEC-FASE2 §E.15)
--
--   select public.import_trello('<quadro>', '<pipeline>', '<e-mail de quem assina>', '<modo>', false);
--     → SIMULA: devolve o resumo e NÃO grava nada.   (true no fim → GRAVA)
--
-- <quadro>: 'diagramacao' ou 'pedagogico' (coluna `quadro` do CSV).
-- <modo>:
--   'ordem'    → a 1ª lista aberta do Trello vai para a 1ª etapa do pipeline, a
--                2ª para a 2ª, e assim por diante (os nomes podem ser diferentes).
--   'primeira' → tudo vai para a primeira etapa do pipeline (Backlog).
--
-- Regras:
--   • card ativo em lista aberta      → etapa conforme o modo;
--   • card ativo em lista ARQUIVADA   → primeira etapa;
--   • card arquivado no Trello        → entra ARQUIVADO (fora do quadro, na lista
--                                       "Arquivados" do pipeline), na etapa da lista dele;
--   • título, descrição, links anexados e checklists (com o que já estava marcado);
--   • no topo da descrição: a lista do Trello, as etiquetas e os membros;
--   • a data de criação do card é a do Trello.
-- Rodar de novo não duplica. Só roda pelo SQL Editor. Não contém dados.
-- ============================================================================

create or replace function public.import_trello(
  p_quadro text,
  p_board  text,
  p_author text,
  p_modo   text default 'ordem',
  p_apply  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b         board%rowtype;
  v_author  uuid;
  v_stages  uuid[];
  v_names   text[];
  v_first   uuid;
  r         record;
  v_stage   uuid;
  v_idx     int;
  v_card    uuid;
  v_cl      uuid;
  v_desc    text;
  v_info    text;
  v_done    boolean;
  ck        jsonb;
  v_pos     numeric := 0;
  v_n       int;
  n_ativos  int := 0;
  n_arq     int := 0;
  n_pulados int := 0;
  n_anexos  int := 0;
  n_check   int := 0;
  n_itens   int := 0;
  por_etapa jsonb := '{}'::jsonb;
  mapa      jsonb := '{}'::jsonb;
  avisos    text[] := '{}';
  v_key     text;
  resumo    jsonb;
begin
  if p_modo not in ('ordem', 'primeira') then
    raise exception 'Modo "%" desconhecido: use ''ordem'' ou ''primeira''.', p_modo;
  end if;
  select * into b from board where lower(trim(name)) = lower(trim(p_board)) and archived_at is null;
  if not found then raise exception 'Pipeline "%" não encontrado.', p_board; end if;
  select id into v_author from app_user
   where organization_id = b.organization_id and lower(email) = lower(trim(p_author));
  if v_author is null then raise exception 'Usuário "%" não encontrado.', p_author; end if;
  if not exists (select 1 from import_trello_cards where quadro = p_quadro) then
    raise exception 'Não há linhas do quadro "%" na tabela import_trello_cards.', p_quadro;
  end if;

  select array_agg(id order by position), array_agg(name order by position)
    into v_stages, v_names from stage where board_id = b.id;
  if v_stages is null then raise exception 'O pipeline "%" não tem etapas.', b.name; end if;
  v_first := v_stages[1];

  -- Tabela de correspondência lista → etapa, para a conferência.
  for r in
    select lista, lista_ordem::int as ord, count(*) filter (where arquivado <> 'true') as ativos,
           count(*) filter (where arquivado = 'true') as arquivados
      from import_trello_cards
     where quadro = p_quadro and nullif(lista_ordem, '') is not null
     group by lista, lista_ordem::int order by lista_ordem::int
  loop
    v_idx := case when p_modo = 'ordem' then r.ord else 1 end;
    if v_idx > array_length(v_stages, 1) then
      avisos := array_append(avisos, format('A lista "%s" é a %sª do Trello, mas o pipeline só tem %s etapas: os cards dela vão para a primeira etapa.', r.lista, r.ord, array_length(v_stages, 1)));
      v_idx := 1;
    end if;
    mapa := mapa || jsonb_build_object(lpad(r.ord::text, 2, '0') || ' ' || r.lista,
              format('→ %s (%s ativos, %s arquivados)', v_names[v_idx], r.ativos, r.arquivados));
  end loop;
  if p_modo = 'ordem' and array_length(v_stages, 1) > (select count(distinct lista_ordem) from import_trello_cards where quadro = p_quadro and nullif(lista_ordem, '') is not null) then
    avisos := array_append(avisos, 'O pipeline tem mais etapas do que o Trello tem listas abertas: confira a correspondência em "listas_para_etapas".');
  end if;

  select coalesce(max(position), 0) into v_pos from card where board_id = b.id;

  begin
    for r in
      select t.*,
             nullif(t.lista_ordem, '')::int as ord,
             (t.arquivado = 'true') as is_arq,
             (t.lista_arquivada = 'true') as lista_arq,
             coalesce(nullif(t.etiquetas, ''), '[]')::jsonb  as j_etq,
             coalesce(nullif(t.membros, ''), '[]')::jsonb    as j_mem,
             coalesce(nullif(t.anexos, ''), '[]')::jsonb     as j_anx,
             coalesce(nullif(t.checklists, ''), '[]')::jsonb as j_chk,
             coalesce(nullif(t.criado_em, '')::timestamptz, now())     as t_criado,
             coalesce(nullif(t.atualizado_em, '')::timestamptz, now()) as t_atual,
             nullif(t.arquivado_em, '')::timestamptz                   as t_arq
        from import_trello_cards t
       where t.quadro = p_quadro
       order by t.ordem::int
    loop
      if exists (select 1 from import_trello_feito f where f.trello_id = r.trello_id) then
        n_pulados := n_pulados + 1;
        continue;
      end if;

      v_idx := case when p_modo = 'ordem' and r.ord is not null and r.ord <= array_length(v_stages, 1) then r.ord else 1 end;
      v_stage := v_stages[v_idx];
      v_done := exists (select 1 from stage s where s.id = v_stage and s.category = 'done');

      -- Topo da descrição: de onde veio (lista, etiquetas, membros do Trello).
      v_info := 'Trello: lista ' || r.lista || case when r.lista_arq then ' (lista arquivada)' else '' end;
      if jsonb_array_length(r.j_etq) > 0 then
        v_info := v_info || ' · etiquetas: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(r.j_etq) x);
      end if;
      if jsonb_array_length(r.j_mem) > 0 then
        v_info := v_info || ' · membros: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(r.j_mem) x);
      end if;
      v_desc := '<p><em>' || replace(replace(replace(v_info, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</em></p>';
      if trim(coalesce(r.descricao, '')) <> '' then
        v_desc := v_desc || '<p>'
          || replace(replace(replace(replace(r.descricao, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>')
          || '</p>';
      end if;

      v_pos := v_pos + 1000;
      insert into card (organization_id, board_id, stage_id, title, description, position,
                        created_at, updated_at, stage_entered_at, completed_at, archived_at)
      values (b.organization_id, b.id, v_stage, coalesce(nullif(trim(r.titulo), ''), 'Card sem nome'), v_desc, v_pos,
              r.t_criado, r.t_atual, r.t_atual,
              case when v_done then r.t_atual end,
              case when r.is_arq then coalesce(r.t_arq, r.t_atual) end)
      returning id into v_card;
      insert into import_trello_feito (trello_id, card_id) values (r.trello_id, v_card);

      if r.is_arq then n_arq := n_arq + 1;
      else
        n_ativos := n_ativos + 1;
        v_key := v_names[v_idx];
        por_etapa := jsonb_set(por_etapa, array[v_key], to_jsonb(coalesce((por_etapa ->> v_key)::int, 0) + 1));
      end if;

      insert into attachment (organization_id, card_id, kind, label, url, created_at, updated_at)
      select b.organization_id, v_card, 'link', coalesce(nullif(trim(a ->> 'nome'), ''), 'Link'), a ->> 'url', r.t_atual, r.t_atual
        from jsonb_array_elements(r.j_anx) a
       where (a ->> 'url') ~* '^https?://';
      get diagnostics v_n = row_count;
      n_anexos := n_anexos + v_n;

      v_n := 0;
      for ck in select * from jsonb_array_elements(r.j_chk) loop
        insert into checklist (organization_id, card_id, name, position)
        values (b.organization_id, v_card, coalesce(nullif(trim(ck ->> 'nome'), ''), 'Checklist'), v_n)
        returning id into v_cl;
        v_n := v_n + 1;
        n_check := n_check + 1;
        insert into checklist_item (checklist_id, text, done, position)
        select v_cl, i.item ->> 'texto', coalesce((i.item ->> 'feito')::boolean, false), (i.ord - 1)::int
          from jsonb_array_elements(coalesce(ck -> 'itens', '[]'::jsonb)) with ordinality as i(item, ord)
         where trim(coalesce(i.item ->> 'texto', '')) <> '';
        n_itens := n_itens + (select count(*) from checklist_item where checklist_id = v_cl);
      end loop;

      insert into activity (organization_id, card_id, actor_id, kind, payload, created_at)
      values (b.organization_id, v_card, v_author, 'legacy_note',
              jsonb_build_object('text', 'Importado do Trello (lista ' || r.lista || ').'), now());
    end loop;

    resumo := jsonb_build_object(
      'modo', case when p_apply then 'GRAVADO' else 'SIMULAÇÃO (nada foi gravado)' end,
      'pipeline', b.name,
      'quadro_do_trello', p_quadro,
      'listas_para_etapas', mapa,
      'cards_ativos_criados', n_ativos,
      'ativos_por_etapa', por_etapa,
      'cards_arquivados_criados', n_arq,
      'ja_importados_antes', n_pulados,
      'links_anexados', n_anexos,
      'checklists', n_check,
      'itens_de_checklist', n_itens,
      'avisos', to_jsonb(avisos));

    if not p_apply then raise exception using errcode = 'P0999', message = 'simulacao'; end if;
  exception when sqlstate 'P0999' then
    null;
  end;

  return resumo;
end$$;

revoke all on function public.import_trello(text, text, text, text, boolean) from public, anon, authenticated;
