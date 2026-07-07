-- ============================================================================
-- 0009_notification_realtime.sql — Notificações in-app em tempo real (sininho)
--
-- Publica `notification` no Realtime para o sino atualizar sem recarregar. O RLS
-- (notification_read: user_id = auth.uid(), migration 0002) já escopa as linhas.
-- Idempotente.
-- ============================================================================

alter table notification replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification'
  ) then
    alter publication supabase_realtime add table notification;
  end if;
end$$;
