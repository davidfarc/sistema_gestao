-- ============================================================================
-- 0012_area_manager_scoping.sql — Gestor de área: escopo por pipeline + papéis
--
-- Modelo (decidido 2026-07-07):
--   * board_member define quais pipelines cada usuário NÃO-Gestor enxerga.
--   * Quem tem 'board:configure' (Gestor) enxerga TODOS os pipelines da org.
--   * Papel novo "Gestor de área": gerencia cards + etapas + grupos de conversa,
--     mas NÃO edita propriedades nem cria usuários; vê só os pipelines onde é membro.
--   * Backfill: todo interno atual vira membro de todos os pipelines atuais
--     (preserva a visibilidade de hoje; o Gestor depois ajusta).
-- Idempotente.
-- ============================================================================

-- ── board_member: escopo de pipeline por usuário ────────────────────────────
create table if not exists board_member (
  board_id   uuid not null references board(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_member_user_idx on board_member (user_id);

alter table board_member enable row level security;
alter table board_member force row level security;
grant select on board_member to authenticated;

-- ── Helper: o usuário atual tem a permissão p_action (via seus papéis)? ──────
create or replace function public.has_permission(p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_role ur
    join role r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.permissions ? p_action
  )
$$;

-- ── can_see_board: interno com board:configure vê tudo; senão só onde é membro ─
create or replace function public.can_see_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then
      case
        when public.has_permission('board:configure') then
          exists (select 1 from board b
                  where b.id = p_board_id and b.organization_id = public.current_org())
        else
          exists (select 1 from board_member m
                  where m.board_id = p_board_id and m.user_id = auth.uid())
      end
    else
      exists (select 1 from assignment a
              join card c on c.id = a.card_id
              where c.board_id = p_board_id and a.user_id = auth.uid()
                and a.archived_at is null)
  end
$$;

-- ── can_see_card: interno agora depende de enxergar o BOARD do card ──────────
create or replace function public.can_see_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then
      exists (select 1 from card c
              where c.id = p_card_id
                and c.organization_id = public.current_org()
                and public.can_see_board(c.board_id))
    else
      exists (select 1 from assignment a
              where a.card_id = p_card_id and a.user_id = auth.uid()
                and a.archived_at is null)
  end
$$;

-- ── Policy de leitura de board_member (o próprio, ou Gestor vê todos) ─────────
drop policy if exists board_member_read on board_member;
create policy board_member_read on board_member for select to authenticated
  using (user_id = auth.uid() or public.has_permission('board:configure'));

-- ── Papéis: Gestor ganha as permissões novas; cria "Gestor de área" ─────────
do $$
declare org_id uuid;
begin
  for org_id in select id from organization loop
    update role set permissions = to_jsonb(array[
      'board:read','board:configure','card:read','card:create','card:update',
      'card:move','card:assign','comment:create','channel:read','channel:post',
      'channel:manage','field:manage','stage:manage','user:manage','workflow:manage'
    ]) where organization_id = org_id and name = 'Gestor';

    if not exists (select 1 from role where organization_id = org_id and name = 'Gestor de área') then
      insert into role (organization_id, name, permissions)
      values (org_id, 'Gestor de área', to_jsonb(array[
        'board:read','card:read','card:create','card:update','card:move','card:assign',
        'comment:create','channel:read','channel:post','channel:manage','stage:manage']));
    end if;
  end loop;
end$$;

-- ── Backfill: interno atual vira membro de todos os pipelines atuais ─────────
insert into board_member (board_id, user_id)
select b.id, u.id
from board b
join app_user u on u.organization_id = b.organization_id and u.is_internal = true
on conflict do nothing;
