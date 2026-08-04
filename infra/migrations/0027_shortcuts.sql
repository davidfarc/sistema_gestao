-- Atalhos da tela Início: links que o Gestor cadastra e todos veem.
-- Servem para dois casos: apontar direto para um pipeline específico
-- (/board?board=<id>) ou para fora (portfólio no Canva, playbook de vendas…).
--
-- `href` guarda os dois: caminho interno começa com "/", externo com "http".
-- Assim não é preciso uma tabela por tipo, e a UI decide como abrir.

create table if not exists shortcut (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id) on delete cascade,
  label           text not null,
  description     text,
  href            text not null,
  icon            text,             -- nome do ícone (lista curada na UI)
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shortcut_org_idx on shortcut (organization_id, position);

alter table shortcut enable row level security;
alter table shortcut force row level security;

-- Leitura: qualquer autenticado da organização (os atalhos são institucionais).
drop policy if exists shortcut_read on shortcut;
create policy shortcut_read on shortcut for select to authenticated
  using (organization_id = public.current_org());

grant select on shortcut to authenticated;

-- Escrita é server-side (service_role) com checagem de permissão na action.
drop trigger if exists shortcut_set_updated_at on shortcut;
create trigger shortcut_set_updated_at before update on shortcut
  for each row execute function set_updated_at();
