-- ============================================================================
-- 0010_board_optional_year.sql — Pipelines genéricos (sem ano letivo obrigatório)
--
-- A taxonomia foi removida do produto; um pipeline (board) agora pode ser
-- criado só com um nome. Torna board.ano_letivo_id opcional. Idempotente.
-- ============================================================================

alter table board alter column ano_letivo_id drop not null;
