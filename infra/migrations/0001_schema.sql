-- ============================================================================
-- 0001_schema.sql — Esquema base do Sistema de Gestão Editorial (Ecco Prime)
-- Postgres/Supabase. Aplicar na ordem dos arquivos (0001, 0002_rls, 0003_seed).
--
-- Convenções (PLANO.md):
--   id uuid, created_at/updated_at, soft-delete via archived_at,
--   organization_id em tudo (mono-tenant agora, barato pra crescer).
--   O que o gestor configura (stage, role, matéria, série, campo) é DADO,
--   nunca enum no código. Só vira CHECK o que é realmente fixo no produto.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Trigger utilitário: mantém updated_at em toda alteração.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Organização & pessoas
-- ─────────────────────────────────────────────────────────────────────────────

create table organization (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email_domain  text not null,             -- ex.: editoraeccoprime.com.br
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Espelho de auth.users (Supabase). is_internal = e-mail no domínio da org.
create table app_user (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organization(id),
  email           text not null,
  name            text not null default '',
  is_internal     boolean not null default false,
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index app_user_org_idx on app_user (organization_id);

create table team (               -- raia do BPMN (Diagramação, Revisor externo…)
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table role (               -- data-driven; permissions = jsonb de ações
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name            text not null,
  permissions     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table user_role (
  user_id uuid not null references app_user(id) on delete cascade,
  role_id uuid not null references role(id) on delete cascade,
  primary key (user_id, role_id)
);

create table user_team (
  user_id uuid not null references app_user(id) on delete cascade,
  team_id uuid not null references team(id) on delete cascade,
  primary key (user_id, team_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Taxonomia (entidades configuráveis)
-- ─────────────────────────────────────────────────────────────────────────────

create table segmento (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,            -- FUND2
  name            text not null,            -- Fundamental 2
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (organization_id, code)
);

create table serie (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  segmento_id     uuid not null references segmento(id),
  code            text not null,            -- 7A
  name            text not null,            -- 7º ano
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (organization_id, code)
);

create table materia (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,            -- TEX = Produção de Texto
  name            text not null,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (organization_id, code)
);

create table ano_letivo (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  year            integer not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (organization_id, year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Quadro & pipeline
-- ─────────────────────────────────────────────────────────────────────────────

create table board (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name            text not null,
  ano_letivo_id   uuid not null references ano_letivo(id),
  segmento_id     uuid references segmento(id),   -- quadro por safra/segmento
  card_face_config jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table stage (               -- coluna = etapa do BPMN (linha, não enum)
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  board_id        uuid not null references board(id) on delete cascade,
  name            text not null,
  position        integer not null default 0,
  category        text not null default 'in_progress'
                    check (category in ('backlog','in_progress','review','done')),
  wip_limit       integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index stage_board_idx on stage (board_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- Card — unidade matéria × série × bimestre
-- ─────────────────────────────────────────────────────────────────────────────

create table card (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  board_id        uuid not null references board(id) on delete cascade,
  number          bigint not null default 0, -- ID sequencial por quadro (trigger abaixo)
  -- code/taxonomia OPCIONAIS: o card nasce só com nome; a equipe preenche depois.
  code            text,                     -- TEX-7A-FUND2-1B-2027 (gerado da taxonomia)
  title           text not null,
  -- taxonomia denormalizada (filtro/relatório indexado)
  materia_id      uuid references materia(id),
  serie_id        uuid references serie(id),
  segmento_id     uuid references segmento(id),
  bimestre        smallint check (bimestre between 0 and 4), -- 0 = anual
  ano_letivo_id   uuid references ano_letivo(id),
  -- pipeline
  stage_id        uuid not null references stage(id),
  stage_entered_at timestamptz not null default now(),  -- cycle-time
  position        numeric not null default 1000,        -- índice fracionário
  priority        integer not null default 0,
  due_date        date,
  status          text not null default 'active'
                    check (status in ('active','blocked','done','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (board_id, code),
  unique (board_id, number)
);
create index card_board_stage_idx on card (board_id, stage_id, position);
create index card_stage_idx on card (stage_id);
create index card_code_idx on card (organization_id, code);
create index card_materia_idx on card (materia_id);
create index card_serie_idx on card (serie_id);

-- ID sequencial por quadro (estilo Notion). Escala pequena → max+1 por board.
-- O unique(board_id, number) barra corrida rara; a app pode reprocessar.
create or replace function assign_card_number()
returns trigger language plpgsql as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
      from card where board_id = new.board_id;
  end if;
  return new;
end;
$$;
create trigger card_assign_number before insert on card
  for each row execute function assign_card_number();

-- ─────────────────────────────────────────────────────────────────────────────
-- Volume (agregação M:N — modelado, fora da UI do MVP)
-- ─────────────────────────────────────────────────────────────────────────────

create table volume (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  serie_id        uuid not null references serie(id),
  bimestre        smallint not null check (bimestre between 0 and 4),
  name            text not null,
  isbn            text,
  printer_status  text not null default 'pending'
                    check (printer_status in ('pending','sent','printing','delivered')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table volume_card (        -- regra de agregação configurável por segmento
  volume_id uuid not null references volume(id) on delete cascade,
  card_id   uuid not null references card(id) on delete cascade,
  position  integer not null default 0,
  primary key (volume_id, card_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Campos customizados (tabela tipada — não JSONB puro)
-- ─────────────────────────────────────────────────────────────────────────────

create table field_definition (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id),
  board_id         uuid not null references board(id) on delete cascade,
  name             text not null,
  type             text not null
                     check (type in ('text','number','date','select',
                                     'multi_select','checkbox','member','link','status')),
  config           jsonb not null default '{}'::jsonb,  -- options, formato…
  show_on_card_face boolean not null default false,
  is_filterable    boolean not null default true,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index field_definition_board_idx on field_definition (board_id, position);

create table field_value (
  field_definition_id uuid not null references field_definition(id) on delete cascade,
  card_id             uuid not null references card(id) on delete cascade,
  organization_id     uuid not null references organization(id),
  value_text          text,
  value_number        numeric,
  value_date          date,
  value_bool          boolean,
  value_member_id     uuid references app_user(id),
  value_json          jsonb,     -- multi-select
  primary key (field_definition_id, card_id)
);
-- índices parciais → filtro/relatório indexável por tipo
create index field_value_text_idx  on field_value (field_definition_id, value_text)   where value_text is not null;
create index field_value_num_idx   on field_value (field_definition_id, value_number) where value_number is not null;
create index field_value_date_idx  on field_value (field_definition_id, value_date)   where value_date is not null;
create index field_value_member_idx on field_value (field_definition_id, value_member_id) where value_member_id is not null;
create index field_value_card_idx  on field_value (card_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Checklists / anexos / emendas
-- ─────────────────────────────────────────────────────────────────────────────

create table checklist (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  name            text not null,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index checklist_card_idx on checklist (card_id);

create table checklist_item (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklist(id) on delete cascade,
  text         text not null,
  done         boolean not null default false,
  assignee_id  uuid references app_user(id),   -- "Revisão [pessoa]" / "Feito por [pessoa]"
  position     integer not null default 0
);
create index checklist_item_checklist_idx on checklist_item (checklist_id, position);

create table attachment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  kind            text not null default 'link', -- link de qualquer origem
  label           text not null default '',
  url             text not null,                -- URL clicável (Drive ou não)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index attachment_card_idx on attachment (card_id);

create table emenda (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  round           integer not null default 1,   -- 1ª emenda, 2ª emenda…
  status          text not null default 'aberta'
                    check (status in ('aberta','em_revisao','enviada_autor',
                                      'enviada_diagramacao','concluida')),
  drive_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index emenda_card_idx on emenda (card_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Comunicação
-- ─────────────────────────────────────────────────────────────────────────────

create table comment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  author_id       uuid not null references app_user(id),
  body            text not null,
  mentions        uuid[] not null default '{}',
  parent_id       uuid references comment(id) on delete cascade,  -- thread
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index comment_card_idx on comment (card_id, created_at);

create table channel (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  name            text not null,
  team_id         uuid references team(id),      -- canal por equipe/projeto
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create table channel_member (
  channel_id   uuid not null references channel(id) on delete cascade,
  user_id      uuid not null references app_user(id) on delete cascade,
  last_read_at timestamptz,
  primary key (channel_id, user_id)
);

create table message (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  channel_id      uuid not null references channel(id) on delete cascade,
  author_id       uuid not null references app_user(id),
  body            text not null,
  mentions        uuid[] not null default '{}',   -- mesma forma do comment
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create index message_channel_idx on message (channel_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Acesso (assignment = escopo do externo) & workflow
-- ─────────────────────────────────────────────────────────────────────────────

create table assignment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  user_id         uuid not null references app_user(id) on delete cascade,
  stage_id        uuid references stage(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (card_id, user_id, stage_id)
);
create index assignment_user_idx on assignment (user_id);
create index assignment_card_idx on assignment (card_id);

create table workflow_rule (       -- gate configurável por transição
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organization(id),
  board_id           uuid not null references board(id) on delete cascade,
  from_stage_id      uuid references stage(id),   -- null = qualquer origem
  to_stage_id        uuid not null references stage(id),
  requirement        text not null
                       check (requirement in ('checklist_complete','attachment_present',
                              'field_filled','emenda_concluded','approval','role')),
  requirement_config jsonb not null default '{}'::jsonb,
  enforcement        text not null default 'block' check (enforcement in ('block','warn')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);
create index workflow_rule_board_idx on workflow_rule (board_id, to_stage_id) where is_active;

create table approval (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  stage_id        uuid references stage(id),
  approver_id     uuid not null references app_user(id),
  approved        boolean not null default true,
  note            text,
  created_at      timestamptz not null default now()
);
create index approval_card_idx on approval (card_id);

-- Feed + auditoria (append-only: sem updated_at/archived_at)
create table activity (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid references card(id) on delete set null,
  actor_id        uuid not null references app_user(id),
  kind            text not null,   -- card_created, card_moved, gate_overridden…
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index activity_card_idx on activity (card_id, created_at desc);
create index activity_org_idx on activity (organization_id, created_at desc);

create table notification (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  user_id         uuid not null references app_user(id) on delete cascade,
  kind            text not null,
  payload         jsonb not null default '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notification_user_idx on notification (user_id, created_at desc) where read_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers de updated_at (tabelas com o campo)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'organization','app_user','team','role','segmento','serie','materia',
    'ano_letivo','board','stage','card','volume','field_definition',
    'checklist','attachment','emenda','comment','channel','message',
    'assignment','workflow_rule'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end$$;
