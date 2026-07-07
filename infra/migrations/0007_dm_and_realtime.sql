-- ============================================================================
-- 0007_dm_and_realtime.sql — Conversas diretas (DM) + Supabase Realtime
--
-- Transforma a comunicação num "WhatsApp interno":
--   * DM 1:1 modelada como um `channel` de kind='dm' com 2 membros. `dm_key`
--     (par de UUIDs ordenado) garante 1 DM por par e permite find-or-create.
--   * Habilita Realtime (postgres_changes) em `message`, `channel` e
--     `channel_member`. O RLS já escopa as linhas (só membros do canal).
--
-- ⚠️ Aplicar via POOLER: node --env-file=.env infra/run-sql.mjs \
--      migrations/0007_dm_and_realtime.sql
-- Idempotente (re-rodável).
-- ============================================================================

-- ── DM: kind + dm_key no channel ─────────────────────────────────────────────

alter table channel add column if not exists kind text not null default 'group';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channel_kind_check'
  ) then
    alter table channel add constraint channel_kind_check
      check (kind in ('group','dm'));
  end if;
end$$;

-- Par de usuários ordenado, ex.: "aaaa...:bbbb..." (menor:maior). Só p/ DMs.
alter table channel add column if not exists dm_key text;

-- 1 DM por par de usuários dentro da org (parcial: grupos têm dm_key nulo).
create unique index if not exists channel_dm_key_uidx
  on channel (organization_id, dm_key) where dm_key is not null;

-- ── Realtime: publicar as tabelas de comunicação ─────────────────────────────
-- postgres_changes só entrega linhas de tabelas na publication supabase_realtime.
-- REPLICA IDENTITY FULL: entrega a linha antiga também (necessário p/ filtrar
-- por channel_id em UPDATE/DELETE e p/ o Realtime aplicar RLS na linha inteira).

alter table message        replica identity full;
alter table channel        replica identity full;
alter table channel_member replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message'
  ) then
    alter publication supabase_realtime add table message;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channel'
  ) then
    alter publication supabase_realtime add table channel;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channel_member'
  ) then
    alter publication supabase_realtime add table channel_member;
  end if;
end$$;

-- ── Lista de conversas (estilo WhatsApp) numa chamada só ─────────────────────
-- Por canal do usuário: última mensagem, horário e nº de não-lidas. Para DMs,
-- resolve a "outra pessoa". Ordena por atividade recente. SECURITY DEFINER: o
-- servidor (service_role) passa o próprio user id, já autenticado no app.

create or replace function public.conversation_list(p_user uuid)
returns table (
  channel_id     uuid,
  kind           text,
  name           text,
  other_user_id  uuid,
  other_name     text,
  other_email    text,
  last_body      text,
  last_at        timestamptz,
  unread         bigint
) language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.kind,
    c.name,
    dm.other_id,
    ou.name,
    ou.email,
    lm.body,
    lm.created_at,
    coalesce(uc.cnt, 0)
  from channel c
  join channel_member me on me.channel_id = c.id and me.user_id = p_user
  left join lateral (
    select cm2.user_id as other_id
    from channel_member cm2
    where cm2.channel_id = c.id and cm2.user_id <> p_user
    limit 1
  ) dm on c.kind = 'dm'
  left join app_user ou on ou.id = dm.other_id
  left join lateral (
    select m.body, m.created_at
    from message m
    where m.channel_id = c.id and m.archived_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as cnt
    from message m
    where m.channel_id = c.id and m.archived_at is null
      and m.author_id <> p_user
      and (me.last_read_at is null or m.created_at > me.last_read_at)
  ) uc on true
  where c.archived_at is null
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

grant execute on function public.conversation_list(uuid) to authenticated, service_role;
