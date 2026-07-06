-- ============================================================================
-- 0003_seed.sql — Semente inicial (dados de referência do PROXIMOS-PASSOS.md)
-- Organização, equipes (raias BPMN), papéis, taxonomia, um board e as 19 etapas.
-- Idempotente por código (on conflict do nothing) onde há unique.
-- ============================================================================

do $$
declare
  org_id      uuid;
  ano_id      uuid;
  seg_fund2   uuid;
  v_board_id  uuid;
  pos         integer := 0;
  etapa       text;
  etapas      text[] := array[
    'Comunicação da demanda',
    'Elaboração do documento da demanda',
    'Produção do sumário',
    'Validação do sumário',
    'Escrita do livro',
    'Revisão de área',
    'Reescrita',
    'Diagramação 1',
    'Revisão 1',
    'Avaliação do manuscrito',
    'Supervisão da produção da 1ª emenda',
    'Diagramação 2',
    'Revisão 2',
    'Revisão editorial',
    'Diagramação 3',
    'Revisão Coordenação',
    'Revisão final',
    'Ajuste da versão final',
    'Catálogo'
  ];
begin
  -- Organização
  insert into organization (name, email_domain)
  values ('Editora Ecco Prime', 'editoraeccoprime.com.br')
  on conflict do nothing;
  select id into org_id from organization where email_domain = 'editoraeccoprime.com.br' limit 1;

  -- Equipes (raias do BPMN)
  insert into team (organization_id, name)
  select org_id, t from unnest(array[
    'Direção pedagógica','Coordenação pedagógica','Coordenação editorial',
    'Apoio pedagógico','Apoio editorial (NAI)','Diagramação',
    'Autor','Revisor externo','Administrativo'
  ]) as t
  where not exists (select 1 from team where organization_id = org_id and name = t);

  -- Papéis (permissions = ações do @ecco/core)
  insert into role (organization_id, name, permissions)
  select org_id, 'Gestor', to_jsonb(array[
    'board:read','board:configure','card:read','card:create','card:update',
    'card:move','card:assign','comment:create','channel:read','channel:post',
    'field:manage','workflow:manage'])
  where not exists (select 1 from role where organization_id = org_id and name = 'Gestor');

  insert into role (organization_id, name, permissions)
  select org_id, 'Membro interno', to_jsonb(array[
    'board:read','card:read','card:create','card:update','card:move',
    'comment:create','channel:read','channel:post'])
  where not exists (select 1 from role where organization_id = org_id and name = 'Membro interno');

  insert into role (organization_id, name, permissions)
  select org_id, 'Externo', to_jsonb(array[
    'card:read','card:update','comment:create'])
  where not exists (select 1 from role where organization_id = org_id and name = 'Externo');

  -- Segmentos
  insert into segmento (organization_id, code, name, position)
  values (org_id,'INFANTIL','Infantil',0),
         (org_id,'FUND1','Fundamental 1',1),
         (org_id,'FUND2','Fundamental 2',2),
         (org_id,'MEDIO','Médio',3)
  on conflict (organization_id, code) do nothing;
  select id into seg_fund2 from segmento where organization_id = org_id and code = 'FUND2';

  -- Matérias (code TEX = Produção de Texto)
  insert into materia (organization_id, code, name, position)
  values (org_id,'POR','Português',0),
         (org_id,'MAT','Matemática',1),
         (org_id,'CIE','Ciências',2),
         (org_id,'HIS','História',3),
         (org_id,'GEO','Geografia',4),
         (org_id,'TEX','Produção de Texto',5),
         (org_id,'ART','Artes',6)
  on conflict (organization_id, code) do nothing;

  -- Séries de Fundamental 2 (exemplo: 6º–9º ano)
  insert into serie (organization_id, segmento_id, code, name, position)
  values (org_id, seg_fund2,'6A','6º ano',0),
         (org_id, seg_fund2,'7A','7º ano',1),
         (org_id, seg_fund2,'8A','8º ano',2),
         (org_id, seg_fund2,'9A','9º ano',3)
  on conflict (organization_id, code) do nothing;

  -- Ano letivo
  insert into ano_letivo (organization_id, year) values (org_id, 2027)
  on conflict (organization_id, year) do nothing;
  select id into ano_id from ano_letivo where organization_id = org_id and year = 2027;

  -- Board da safra 2027 / Fundamental 2
  insert into board (organization_id, name, ano_letivo_id, segmento_id, card_face_config)
  select org_id, 'Produção 2027 — Fundamental 2', ano_id, seg_fund2,
         '{"showAssignee":true,"showDueDate":true,"showLabels":true,"fieldDefinitionIds":[]}'::jsonb
  where not exists (
    select 1 from board where organization_id = org_id
      and name = 'Produção 2027 — Fundamental 2');
  select id into v_board_id from board where organization_id = org_id
    and name = 'Produção 2027 — Fundamental 2' limit 1;

  -- 19 etapas do pipeline (ordem do BPMN). category deriva do nome.
  foreach etapa in array etapas loop
    if not exists (select 1 from stage where stage.board_id = v_board_id and stage.name = etapa) then
      insert into stage (organization_id, board_id, name, position, category)
      values (
        org_id, v_board_id, etapa, pos,
        case
          when pos = 0 then 'backlog'
          when etapa = 'Catálogo' then 'done'
          when etapa ilike 'Revis%' or etapa ilike 'Valida%' or etapa ilike 'Avalia%' then 'review'
          else 'in_progress'
        end
      );
    end if;
    pos := pos + 1;
  end loop;
end$$;
