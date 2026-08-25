-- Alinha os dados ao comportamento novo da priorização (ver lib/demandas/queue.ts).
--
-- Até aqui, priorizar só criava a linha em `prioritization`: não movia o card.
-- Resultado: demanda priorizada parada em "Aguardando priorização" — ou pior,
-- priorizada lá de trás, pela seção "Demais demandas" do painel, que oferecia o
-- botão para cards que nem tinham chegado ao checkpoint.
--
-- Regra agora: só se prioriza NO checkpoint, e priorizar avança o card para a
-- etapa seguinte. Esta migration corrige o passado em duas frentes:
--   1. priorização feita ANTES do checkpoint  → arquivada (o card fica onde está);
--   2. card priorizado PARADO no checkpoint    → avança para a etapa seguinte.
--
-- Idempotente: rodar de novo não acha mais nada para corrigir.

do $$
declare
  r           record;
  v_next      uuid;
  n_arquivada integer := 0;
  n_movida    integer := 0;
begin
  for r in
    select
      p.id            as prio_id,
      p.card_id,
      p.prioritized_by,
      c.organization_id,
      c.stage_id,
      w.board_id,
      cp.id           as checkpoint_id,
      cp.position     as checkpoint_pos,
      s.position      as card_pos
    from workflow_rule w
    join prioritization p
      on p.board_id = w.board_id and p.archived_at is null
    join card c   on c.id = p.card_id and c.archived_at is null
    join stage s  on s.id = c.stage_id
    join stage cp on cp.id = (w.requirement_config->>'checkpointStageId')::uuid
    where w.requirement = 'prioritized'
      and w.is_active
      and w.requirement_config->>'checkpointStageId' is not null
  loop
    -- 1. Priorizada cedo demais: some da fila, mas não mexe no card — ele segue
    --    o fluxo normal e será priorizado quando chegar ao checkpoint.
    if r.card_pos < r.checkpoint_pos then
      update prioritization set archived_at = now() where id = r.prio_id;

      insert into activity (organization_id, card_id, actor_id, kind, payload)
      values (r.organization_id, r.card_id, r.prioritized_by, 'demand_deprioritized',
              jsonb_build_object('motivo', 'priorizada antes do checkpoint (correcao 0031)'));

      n_arquivada := n_arquivada + 1;

    -- 2. Priorizada e parada no checkpoint: avança, que é o que priorizar
    --    passou a significar.
    elsif r.card_pos = r.checkpoint_pos then
      select id into v_next
        from stage
       where board_id = r.board_id and position > r.checkpoint_pos
       order by position
       limit 1;

      if v_next is null then
        raise notice 'Card % : não há etapa depois do checkpoint — nada a fazer.', r.card_id;
        continue;
      end if;

      update card
         set stage_id = v_next, stage_entered_at = now()
       where id = r.card_id;

      insert into activity (organization_id, card_id, actor_id, kind, payload)
      values (r.organization_id, r.card_id, r.prioritized_by, 'card_moved',
              jsonb_build_object('toStageId', v_next::text, 'reason', 'prioritized',
                                 'motivo', 'correcao 0031'));

      n_movida := n_movida + 1;
    end if;
    -- card_pos > checkpoint_pos: já está adiante, nada a corrigir.
  end loop;

  raise notice 'Priorizações arquivadas (antes do checkpoint): %', n_arquivada;
  raise notice 'Cards avançados a partir do checkpoint: %', n_movida;
end$$;
