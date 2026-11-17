-- ============================================================================
-- 0047_card_read_all.sql — "Ver todos os cards" como permissão do papel
-- (SPEC-FASE2 §E.14)
--
-- Até aqui, quem enxerga um pipeline enxerga TODOS os cards dele. A partir
-- daqui isso é uma permissão do papel (`card:read_all`, "Ver todos os cards do
-- pipeline"). Sem ela, a pessoa vê só os cards dela: aqueles em que é
-- responsável ou solicitante.
--
-- 1. Todo papel que existe hoje, exceto o Externo, GANHA a permissão: ninguém
--    perde visão ao aplicar esta migration. A restrição só começa quando a
--    gestão desmarcar a permissão de um papel (Configurações → Papéis).
-- 2. `can_see_card` passa a conferir a permissão. O resto do sistema já
--    depende dela (comentários, checklists, valores, tempo, histórico).
--
-- Idempotente.
-- ============================================================================

update role
   set permissions = permissions || '["card:read_all"]'::jsonb
 where archived_at is null
   and coalesce(slug, '') <> 'externo'
   and not permissions @> '["card:read_all"]'::jsonb;

create or replace function public.can_see_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then
      exists (
        select 1 from card c
        where c.id = p_card_id
          and c.organization_id = public.current_org()
          and (
            -- O que a própria pessoa pediu, mesmo fora dos pipelines dela (0028).
            c.requester_id = auth.uid()
            or (
              public.can_see_board(c.board_id)
              and (
                public.has_permission('card:read_all')
                -- Sem "ver todos": só os cards em que é responsável.
                or exists (
                  select 1 from assignment a
                  where a.card_id = c.id and a.user_id = auth.uid()
                    and a.archived_at is null
                )
              )
            )
          )
      )
    else
      exists (
        select 1 from assignment a
        where a.card_id = p_card_id and a.user_id = auth.uid()
          and a.archived_at is null
      )
  end
$$;
