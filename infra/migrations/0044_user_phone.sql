-- ============================================================================
-- 0044_user_phone.sql — Telefone do usuário (SPEC-FASE2 §C, base do WhatsApp)
--
-- O agente do WhatsApp reconhece quem escreve pelo telefone. O telefone fica
-- numa tabela própria, e não em `app_user`, porque `app_user` é lida por toda a
-- equipe interna: aqui cada pessoa lê só o próprio número, e quem gerencia
-- usuários (`user:manage`) lê o de todos. Escrita só pelo servidor.
--
-- Um telefone pertence a uma pessoa só (índice único). Formato E.164
-- ("+5584999998888"), normalizado pelo servidor.
--
-- Só cria a tabela e as regras de acesso. Idempotente.
-- ============================================================================

create table if not exists user_phone (
  user_id         uuid primary key references app_user(id) on delete cascade,
  organization_id uuid not null references organization(id),
  phone           text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at      timestamptz not null default now()
);

create unique index if not exists user_phone_phone_idx on user_phone (phone);

alter table user_phone enable row level security;
alter table user_phone force row level security;

drop policy if exists user_phone_read on user_phone;
create policy user_phone_read on user_phone for select to authenticated
  using (
    user_id = auth.uid()
    or (organization_id = public.current_org() and public.has_permission('user:manage'))
  );

revoke all on user_phone from anon;
revoke insert, update, delete on user_phone from authenticated;
grant select on user_phone to authenticated;
