-- Limites de alçada configuráveis POR PIPELINE (board).
-- Guarda os 4 thresholds do motor (@ecco/core alcadas.ts): limiteFaixaA,
-- limiteFaixaB, limiteGrow, limiteAnualRecorrencia.
--
-- `{}` significa "usa DEFAULT_THRESHOLDS" — por isso não há backfill e o
-- comportamento atual fica preservado. O merge com os defaults acontece no
-- parse (parseThresholds), não no banco.
--
-- Sem policy nova: `board` já tem SELECT para authenticated (0002_rls.sql) e
-- toda escrita é server-side com service_role.
alter table board
  add column if not exists alcada_thresholds jsonb not null default '{}'::jsonb;
