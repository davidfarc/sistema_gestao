-- ============================================================================
-- 0038_lock_definer_functions.sql — Fecha funções SECURITY DEFINER ao navegador
--
-- Duas funções rodam com privilégio total (ignoram o RLS) e confiam num
-- parâmetro informado por quem chama:
--
--   conversation_list(p_user)        devolve as conversas e a última mensagem
--                                    de QUALQUER usuário informado;
--   sala_state_set(p_org, path, val) grava ou apaga qualquer trecho do estado
--                                    da Gestão de Vila da organização informada.
--
-- No Postgres toda função nasce executável por PUBLIC, e a 0007 ainda concedeu
-- a primeira a `authenticated`. Como o Supabase expõe as funções do schema
-- public em /rest/v1/rpc, quem tem um login (ou só a chave pública, no caso de
-- `anon`) podia chamá-las direto, sem passar pelas checagens do servidor.
--
-- O sistema só as chama pelo servidor, com a chave de serviço (service_role).
-- Esta migration deixa a execução restrita a ela. Não altera tabelas nem dados
-- e não muda o comportamento do sistema. Idempotente.
-- ============================================================================

revoke all on function public.conversation_list(uuid) from public;
revoke all on function public.conversation_list(uuid) from anon;
revoke all on function public.conversation_list(uuid) from authenticated;
grant execute on function public.conversation_list(uuid) to service_role;

revoke all on function public.sala_state_set(uuid, text[], jsonb) from public;
revoke all on function public.sala_state_set(uuid, text[], jsonb) from anon;
revoke all on function public.sala_state_set(uuid, text[], jsonb) from authenticated;
grant execute on function public.sala_state_set(uuid, text[], jsonb) to service_role;
