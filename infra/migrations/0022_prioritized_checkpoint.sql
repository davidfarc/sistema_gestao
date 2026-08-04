-- CORRIGE a trava de priorização.
--
-- Antes: a regra travava a SAÍDA da etapa "Aguardando priorização"
-- (from_stage_id = etapa, to_stage_id = null). Bug: dava para PULAR a etapa —
-- ir de "Demanda confirmada" direto para "Prioridade definida" não disparava
-- regra nenhuma, porque o card nunca esteve na etapa travada.
--
-- Agora: a regra guarda a etapa de CHECKPOINT em requirement_config e vale para
-- qualquer destino com posição MAIOR que ela. Com isso:
--   • pular o checkpoint  → bloqueado
--   • sair do checkpoint  → bloqueado
--   • entrar no checkpoint→ liberado (é onde se prioriza)
--   • voltar para trás    → liberado (devolver para ajustes)
-- Etapas criadas depois ficam cobertas automaticamente (a comparação é por posição).
update workflow_rule
set requirement_config = jsonb_build_object('checkpointStageId', from_stage_id::text),
    from_stage_id = null,
    to_stage_id = null
where requirement = 'prioritized'
  and from_stage_id is not null;
