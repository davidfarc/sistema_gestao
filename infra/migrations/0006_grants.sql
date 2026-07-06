-- Garante que o papel `authenticated` (client de sessão) possa LER as tabelas
-- (o RLS gateia as linhas). Escrita continua só pelo servidor (service_role).
-- Idempotente. O Supabase já concede por padrão; isto é cinto+suspensório.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
