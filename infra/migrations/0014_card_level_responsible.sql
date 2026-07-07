-- ============================================================================
-- 0014_card_level_responsible.sql — Responsável por CARD (não por etapa)
--
-- O responsável passa a ser único por card (assignment com stage_id NULO),
-- independente da etapa. Mover o card de etapa não altera o responsável; a
-- troca é manual. Consolida os assignments por-etapa existentes: mantém o da
-- etapa atual (ou o mais recente), zera o stage_id e remove os demais.
-- Idempotente.
-- ============================================================================

with ranked as (
  select a.id,
    row_number() over (
      partition by a.card_id
      order by (a.stage_id = c.stage_id) desc nulls last, a.created_at desc
    ) as rn
  from assignment a
  join card c on c.id = a.card_id
  where a.archived_at is null
)
update assignment set stage_id = null
where id in (select id from ranked where rn = 1) and stage_id is not null;

-- Remove os assignments por-etapa remanescentes (os não escolhidos acima).
delete from assignment where archived_at is null and stage_id is not null;
