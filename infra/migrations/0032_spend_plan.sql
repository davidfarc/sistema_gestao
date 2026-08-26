-- Planejamento de gastos: quanto se pretende gastar por mês e por categoria.
-- É o "todo" que faltava para os gráficos da página de prioridades — sem ele,
-- só dava para dividir a fila por ela mesma, nunca comparar com o orçamento.
--
-- Duas escolhas de modelagem que importam adiante:
--
-- 1. `category_id` guarda o ID da opção do campo (field_definition.config →
--    options[].id), NUNCA o rótulo. Renomear "Estrutura" para "Infraestrutura"
--    não pode orfanar o valor planejado.
-- 2. `category_kind` já prevê a segunda dimensão. Hoje se planeja só por área;
--    quando entrar o planejamento por tipo (RUN/KEEP/GROW/TRANSFORM), basta
--    gravar 'tipo' — sem reestruturar tabela nem perder o que já foi digitado.

-- ── 1. Tabela ────────────────────────────────────────────────────────────────
create table if not exists spend_plan (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid     not null references organization(id),
  board_id        uuid     not null references board(id) on delete cascade,
  year            smallint not null check (year between 2020 and 2100),
  month           smallint not null check (month between 1 and 12),
  category_kind   text     not null check (category_kind in ('area', 'tipo')),
  category_id     text     not null,
  amount          numeric(14, 2) not null default 0 check (amount >= 0),
  updated_by      uuid references app_user(id),
  updated_at      timestamptz not null default now()
);

-- Uma célula da grade = um valor. O upsert da tela depende deste índice.
create unique index if not exists spend_plan_cell_idx
  on spend_plan (board_id, year, month, category_kind, category_id);

create index if not exists spend_plan_board_year_idx
  on spend_plan (board_id, year);

drop trigger if exists spend_plan_updated_at on spend_plan;
create trigger spend_plan_updated_at before update on spend_plan
  for each row execute function set_updated_at();

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Leitura: quem vê o pipeline vê o planejamento dele. Escrita não passa por
-- aqui — vai pelo client admin, depois de a aplicação checar `plan:manage`.
alter table spend_plan enable  row level security;
alter table spend_plan force   row level security;

drop policy if exists spend_plan_read on spend_plan;
create policy spend_plan_read on spend_plan for select to authenticated
  using (public.can_see_board(board_id));

grant select on spend_plan to authenticated;

-- ── 3. Qual etapa significa "compra realizada" ───────────────────────────────
-- Marcada na configuração do quadro, como o checkpoint de priorização já é
-- (ver 0022). Assim renomear ou reordenar colunas não quebra o gráfico.
alter table board add column if not exists purchase_done_stage_id uuid references stage(id);

comment on column board.purchase_done_stage_id is
  'Etapa a partir da qual a demanda conta como REALIZADA nos gráficos. '
  'A partir dela, inclusive: quem avançou para "Concluído" segue realizado.';

do $$
declare
  b record;
  v_stage uuid;
  n integer := 0;
begin
  for b in select id, name from board
            where creation_form = 'custom:demandas'
              and archived_at is null
              and purchase_done_stage_id is null
  loop
    select id into v_stage from stage
      where board_id = b.id and name ilike '%compra%realizada%'
      order by position limit 1;

    if v_stage is null then
      raise notice 'Pipeline "%": nenhuma etapa de compra realizada — marcar à mão.', b.name;
      continue;
    end if;

    update board set purchase_done_stage_id = v_stage where id = b.id;
    n := n + 1;
  end loop;
  raise notice 'Pipelines com etapa de compra realizada marcada: %', n;
end$$;
