-- ============================================================================
-- Importação dos quadros do Trello — PASSO 3: limpeza
--
-- Rodar só depois de conferir os cards no sistema. Apaga as tabelas de passagem
-- (com a cópia dos dados do Trello) e a função de importação. Os cards criados
-- NÃO são afetados.
-- ============================================================================

drop function if exists public.import_trello(text, text, text, text, boolean);
drop table if exists import_trello_feito, import_trello_cards;
