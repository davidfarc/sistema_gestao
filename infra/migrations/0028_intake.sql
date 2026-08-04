-- Caixa de entrada: permitir que alguém de fora do pipeline abra uma demanda.
--
-- Caso real: o gestor pedagógico precisa pedir algo a TI, Estrutura ou
-- Marketing. Ele é usuário interno e tem permissão de criar card, mas não
-- enxerga esses pipelines — e por isso hoje não consegue nem preencher o
-- formulário.
--
-- São duas mudanças independentes, ambas conservadoras:
--   1. `board.intake` decide, POR PIPELINE, quem pode abrir o formulário.
--      O padrão 'members' reproduz o comportamento atual: nada muda sem
--      alguém ligar a chave.
--   2. Quem solicitou um card passa a enxergar aquele card — e só ele.
--      Sem isso, a pessoa envia a demanda e perde o pedido de vista.

-- ---------------------------------------------------------------------------
-- 1. Quem pode abrir o formulário de criação
-- ---------------------------------------------------------------------------

alter table board add column if not exists intake text not null default 'members';

alter table board drop constraint if exists board_intake_check;
alter table board add constraint board_intake_check
  check (intake in ('members', 'org'));

comment on column board.intake is
  'members = só quem tem acesso ao pipeline abre o formulário (padrão); '
  'org = qualquer pessoa interna da organização pode abrir e enviar.';

-- ---------------------------------------------------------------------------
-- 2. O solicitante enxerga o próprio card
-- ---------------------------------------------------------------------------

-- Exceção estreita e deliberada: o `or` abaixo libera UM card específico — o
-- que a própria pessoa pediu — sem tocar em `can_see_board`. Se ela fosse
-- liberada no board, veria TODOS os cards dele, porque para usuário interno a
-- visibilidade de card deriva da visibilidade do board. Por isso a exceção
-- entra aqui, no card, e não lá.
create or replace function public.can_see_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then
      exists (
        select 1 from card c
        where c.id = p_card_id
          and c.organization_id = public.current_org()
          and (public.can_see_board(c.board_id) or c.requester_id = auth.uid())
      )
    else
      exists (
        select 1 from assignment a
        where a.card_id = p_card_id and a.user_id = auth.uid()
          and a.archived_at is null
      )
  end
$$;

-- A página do card precisa das definições de campo e do nome da etapa. Ambas
-- são escopadas por `can_see_board`, que continua falso para o solicitante —
-- então a página abriria sem propriedades e sem etapa. As duas policies abaixo
-- reconhecem o mesmo vínculo: existe um card MEU neste pipeline.
-- O predicado é direto (`requester_id`), sem chamar `can_see_card`, para não
-- criar recursão entre policies.

drop policy if exists field_definition_read on field_definition;
create policy field_definition_read on field_definition for select to authenticated
  using (
    (field_definition.board_id is null
       and field_definition.organization_id = public.current_org())
    or public.can_see_board(field_definition.board_id)
    or exists (
      select 1 from card c
      where c.board_id = field_definition.board_id
        and c.requester_id = auth.uid()
        and c.archived_at is null
    )
  );

drop policy if exists stage_read on stage;
create policy stage_read on stage for select to authenticated
  using (
    public.can_see_board(stage.board_id)
    or exists (
      select 1 from card c
      where c.board_id = stage.board_id
        and c.requester_id = auth.uid()
        and c.archived_at is null
    )
  );

-- Sustenta os `exists` acima. Nome próprio: `card_requester_idx` já existe
-- desde a 0023 com outra definição, e um `if not exists` naquele nome seria
-- ignorado em silêncio, deixando as policies sem índice.
create index if not exists card_requester_board_idx on card (requester_id, board_id)
  where archived_at is null;
