-- ============================================================================
-- 0043_area_time_read.sql — Gestor de área vê o tempo da equipe nos pipelines dele
--
-- Decidido em 16/11: o Gestor de área enxerga os relatórios dos pipelines em
-- que é membro, inclusive "Tempo por tarefa". A permissão `time:read` não abre
-- nada além disso: a policy de `time_entry` (0041) só libera períodos de cards
-- que a pessoa enxerga (`can_see_card`), e o Gestor de área só enxerga os
-- pipelines em que é membro (`can_see_board`, 0012).
--
-- Só concede a permissão ao papel de sistema "area". Idempotente.
-- ============================================================================

update role
   set permissions = permissions || '["time:read"]'::jsonb
 where slug = 'area'
   and archived_at is null
   and not permissions @> '["time:read"]'::jsonb;
