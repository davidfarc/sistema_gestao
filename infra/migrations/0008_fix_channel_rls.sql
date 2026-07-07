-- ============================================================================
-- 0008_fix_channel_rls.sql — Corrige recursão infinita nas policies de canais
--
-- A policy `channel_member_read` (migration 0002) consultava a própria tabela
-- `channel_member` no seu USING → "infinite recursion detected in policy for
-- relation channel_member". Como `message_read` e `channel_read` também
-- consultam `channel_member` inline, a leitura de mensagens quebrava (o client
-- de sessão recebia erro e o corpo da conversa ficava vazio).
--
-- Correção: um helper SECURITY DEFINER (dono postgres, BYPASSRLS) resolve a
-- filiação sem reentrar nas policies — mesmo padrão de `can_see_card`.
-- Idempotente.
-- ============================================================================

create or replace function public.is_channel_member(p_channel_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channel_member m
    where m.channel_id = p_channel_id and m.user_id = auth.uid()
  )
$$;

-- Recria as policies usando o helper (sem subquery direta em channel_member).

drop policy if exists channel_read on channel;
create policy channel_read on channel for select to authenticated
  using (public.is_channel_member(id));

drop policy if exists channel_member_read on channel_member;
create policy channel_member_read on channel_member for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists message_read on message;
create policy message_read on message for select to authenticated
  using (public.is_channel_member(channel_id));
