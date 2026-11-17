-- ============================================================================
-- Importação do sistema antigo "Produção Pedagógica" — PASSO 3: limpeza
--
-- Rodar só depois de conferir os cards no sistema. Apaga as tabelas de passagem
-- (com os dados do sistema antigo) e a função de importação. Os cards criados
-- NÃO são afetados.
-- ============================================================================

drop function if exists public.import_producao_pedagogica(text, text, boolean);
drop table if exists import_pp_feito, import_pp_diario, import_pp_pareceres, import_pp_materiais, import_pp_membros;
