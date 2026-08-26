-- Concede `plan:manage` a quem decide orçamento: Gestor Master e Gestor.
--
-- Sem isto a permissão existe no código e aparece no editor de papéis, mas
-- ninguém a tem — e a tela de planejamento ficaria inacessível até para quem
-- criou o sistema. "Gestor de área" fica de fora de propósito: ele executa
-- dentro do orçamento, não o define. Conceda pelo editor de papéis se quiser.
--
-- Idempotente: quem já tem não recebe duas vezes.
update role
   set permissions = permissions || '["plan:manage"]'::jsonb
 where slug in ('master', 'gestor')
   and archived_at is null
   and not permissions @> '["plan:manage"]'::jsonb;
