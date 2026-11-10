-- Novos alunos (central de anamneses) passa a obedecer o gerenciador de papéis.
--
-- `novos:access`  → agenda, agendamentos e relatórios (atendimento/coordenação)
-- `novos:manage`  → também psicólogas, segmentos, configurações e auditoria
--
-- Gestor Master e Gestor recebem as duas: sem isto as permissões existem no
-- editor de papéis, mas ninguém as tem e a seção fica fechada para todos.
-- Psicólogas não dependem delas: entram pelo cadastro de Psicólogas da central.
--
-- Idempotente.
update role
   set permissions = permissions || '["novos:access"]'::jsonb
 where slug in ('master', 'gestor')
   and archived_at is null
   and not permissions @> '["novos:access"]'::jsonb;

update role
   set permissions = permissions || '["novos:manage"]'::jsonb
 where slug in ('master', 'gestor')
   and archived_at is null
   and not permissions @> '["novos:manage"]'::jsonb;
