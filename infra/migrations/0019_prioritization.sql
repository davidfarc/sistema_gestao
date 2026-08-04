-- Priorização de demandas: o ato explícito de priorizar (quem/quando/posição)
-- e o gate que trava a saída da etapa "Aguardando priorização".
--
-- "Priorizada" = RICE completo (verificado no app) + uma linha viva aqui.
-- Despriorizar arquiva a linha (histórico preservado), não deleta.

-- ── 1. Tabela ────────────────────────────────────────────────────────────────
create table if not exists prioritization (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  board_id        uuid not null references board(id) on delete cascade,
  card_id         uuid not null references card(id) on delete cascade,
  prioritized_by  uuid not null references app_user(id),
  prioritized_at  timestamptz not null default now(),
  rank            numeric not null,        -- índice fracionário (core/ranking.ts)
  rice_snapshot   numeric,                 -- RICE no momento do ato (auditoria)
  note            text,
  archived_at     timestamptz
);

-- Só uma priorização viva por card.
create unique index if not exists prioritization_card_live_idx
  on prioritization (card_id) where archived_at is null;
create index if not exists prioritization_board_rank_idx
  on prioritization (board_id, rank) where archived_at is null;

-- ── 2. RLS (deny-by-default; leitura escopada como em approval_read) ─────────
alter table prioritization enable row level security;
alter table prioritization force row level security;

drop policy if exists prioritization_read on prioritization;
create policy prioritization_read on prioritization for select to authenticated
  using (public.can_see_card(card_id));

grant select on prioritization to authenticated;

-- ── 3. Gate: novo requisito + destino opcional ───────────────────────────────
-- `to_stage_id` nulo = "qualquer destino", simétrico ao from_stage_id que já
-- significa "qualquer origem". Permite travar a SAÍDA de uma etapa.
alter table workflow_rule alter column to_stage_id drop not null;

alter table workflow_rule drop constraint if exists workflow_rule_requirement_check;
alter table workflow_rule add constraint workflow_rule_requirement_check
  check (requirement in ('checklist_complete','attachment_present','field_filled',
                         'emenda_concluded','approval','role','prioritized'));

-- ── 4. Regra para os pipelines de demandas ───────────────────────────────────
-- Alvo: boards com formulário de demandas (creation_form = 'custom:demandas'),
-- travando a saída da etapa "Aguardando priorização".
do $$
declare
  b record;
  v_stage uuid;
  n integer := 0;
begin
  for b in select id, organization_id, name from board where creation_form = 'custom:demandas'
  loop
    select id into v_stage from stage
      where board_id = b.id and name ilike '%aguardando%prioriza%'
      limit 1;

    if v_stage is null then
      raise notice 'Pipeline "%": nenhuma etapa "Aguardando priorização" — regra NÃO criada.', b.name;
      continue;
    end if;

    if exists (select 1 from workflow_rule
               where board_id = b.id and requirement = 'prioritized') then
      raise notice 'Pipeline "%": regra de priorização já existe.', b.name;
      continue;
    end if;

    -- A etapa vai em requirement_config como CHECKPOINT: a regra vale para
    -- qualquer destino de posição maior (ver 0022). Assim ninguém pula a etapa.
    insert into workflow_rule
      (organization_id, board_id, from_stage_id, to_stage_id, requirement,
       requirement_config, enforcement, is_active)
    values
      (b.organization_id, b.id, null, null, 'prioritized',
       jsonb_build_object('checkpointStageId', v_stage::text), 'block', true);
    n := n + 1;
    raise notice 'Pipeline "%": trava de priorização criada.', b.name;
  end loop;

  if n = 0 then
    raise notice 'Nenhuma regra nova criada (verifique se há pipeline com creation_form=custom:demandas).';
  end if;
end$$;
