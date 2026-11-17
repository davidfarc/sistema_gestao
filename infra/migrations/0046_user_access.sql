-- ============================================================================
-- 0046_user_access.sql — Acessos pontuais por pessoa (SPEC-FASE2 §E.13)
--
-- Gestão de Vila e Novos alunos deixam de ser abertos por padrão: só entra quem
-- tem a permissão no papel (Gestor e Gestor Master) ou quem recebeu o acesso
-- pontual, concedido por um Gestor em Configurações → Usuários.
--
-- 1. `user_grant`: um acesso pontual por linha ('salas' = Gestão de Vila;
--    'novos' = Novos alunos). Cada pessoa lê os seus; quem gerencia usuários lê
--    todos. Escrita só pelo servidor.
-- 2. `has_access(chave)`: tem a permissão no papel OU o acesso pontual.
-- 3. A leitura dos dados da Vila (`sala_state`) passa a exigir esse acesso
--    (antes: qualquer pessoa interna).
--
-- Idempotente.
-- ============================================================================

create table if not exists user_grant (
  user_id         uuid not null references app_user(id) on delete cascade,
  organization_id uuid not null references organization(id),
  key             text not null check (key in ('salas', 'novos')),
  created_at      timestamptz not null default now(),
  primary key (user_id, key)
);

alter table user_grant enable row level security;
alter table user_grant force row level security;

drop policy if exists user_grant_read on user_grant;
create policy user_grant_read on user_grant for select to authenticated
  using (
    user_id = auth.uid()
    or (organization_id = public.current_org() and public.has_permission('user:manage'))
  );

revoke all on user_grant from anon;
revoke insert, update, delete on user_grant from authenticated;
grant select on user_grant to authenticated;

create or replace function public.has_access(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_key
           when 'salas' then public.has_permission('salas:manage')
           when 'novos' then public.has_permission('novos:access') or public.has_permission('novos:manage')
           else false
         end
      or exists (select 1 from user_grant g where g.user_id = auth.uid() and g.key = p_key)
$$;

revoke all on function public.has_access(text) from public, anon;
grant execute on function public.has_access(text) to authenticated, service_role;

drop policy if exists sala_state_read on sala_state;
create policy sala_state_read on sala_state for select to authenticated
  using (
    public.is_internal()
    and organization_id = public.current_org()
    and public.has_access('salas')
  );
