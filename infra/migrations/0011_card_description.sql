-- ============================================================================
-- 0011_card_description.sql — Descrição longa do card (texto livre)
--
-- Campo de descrição longa, exibido/editado na visão expandida do card
-- (página /card/[id]). Idempotente.
-- ============================================================================

alter table card add column if not exists description text;
