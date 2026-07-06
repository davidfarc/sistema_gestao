-- ============================================================================
-- 0002_rls.sql — Row Level Security (defesa em profundidade)
--
-- Modelo (PLANO.md):
--   * RLS ligado em tudo, DENY-BY-DEFAULT.
--   * Papel `authenticated` (cliente/Realtime) só LÊ, e com escopo:
--       - INTERNO: enxerga tudo da própria organização.
--       - EXTERNO: enxerga um card só se houver `assignment` dele.
--   * Toda ESCRITA passa pelo servidor (core) usando a service_role key, que
--     BYPASSA RLS. Por isso não criamos policies de INSERT/UPDATE/DELETE para
--     `authenticated`: escrita direta do cliente fica barrada (gate não-burlável).
--   * Recurso não visível responde como inexistente (a app traduz para 404).
--
--   ⚠️ Validar com o teste automatizado de isolamento do externo (verificação §5)
--      contra a instância real antes de confiar.
-- ============================================================================

-- ── Helpers (SECURITY DEFINER para ler app_user sem recursão de policy) ──────

create or replace function public.current_org()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from app_user where id = auth.uid()
$$;

create or replace function public.is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_internal from app_user where id = auth.uid()), false)
$$;

create or replace function public.can_see_card(p_card_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case
      when public.is_internal() then
        exists (select 1 from card c
                where c.id = p_card_id and c.organization_id = public.current_org())
      else
        exists (select 1 from assignment a
                where a.card_id = p_card_id and a.user_id = auth.uid()
                  and a.archived_at is null)
    end
$$;

-- Boards que o externo pode ver = boards com card atribuído a ele.
create or replace function public.can_see_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case
      when public.is_internal() then
        exists (select 1 from board b
                where b.id = p_board_id and b.organization_id = public.current_org())
      else
        exists (select 1 from assignment a
                join card c on c.id = a.card_id
                where c.board_id = p_board_id and a.user_id = auth.uid()
                  and a.archived_at is null)
    end
$$;

-- ── Habilita RLS em todas as tabelas ─────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'organization','app_user','team','role','user_role','user_team',
    'segmento','serie','materia','ano_letivo','board','stage','card',
    'volume','volume_card','field_definition','field_value','checklist',
    'checklist_item','attachment','emenda','comment','channel','channel_member',
    'message','assignment','workflow_rule','approval','activity','notification'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end$$;

-- ── Policies de LEITURA (SELECT) para o papel authenticated ──────────────────
-- (sem policies de escrita → cliente não escreve; server usa service_role)

-- Config org-global de baixa sensibilidade: qualquer autenticado da org lê.
create policy org_read on organization for select to authenticated
  using (id = public.current_org());

create policy app_user_read on app_user for select to authenticated
  using (organization_id = public.current_org());

create policy team_read on team for select to authenticated
  using (organization_id = public.current_org());

create policy role_read on role for select to authenticated
  using (organization_id = public.current_org());

create policy user_role_read on user_role for select to authenticated
  using (exists (select 1 from app_user u where u.id = user_role.user_id
                 and u.organization_id = public.current_org()));

create policy user_team_read on user_team for select to authenticated
  using (exists (select 1 from app_user u where u.id = user_team.user_id
                 and u.organization_id = public.current_org()));

-- Taxonomia (nomes/códigos): autenticado da org lê (externo precisa p/ render).
create policy segmento_read  on segmento  for select to authenticated using (organization_id = public.current_org());
create policy serie_read     on serie     for select to authenticated using (organization_id = public.current_org());
create policy materia_read   on materia   for select to authenticated using (organization_id = public.current_org());
create policy ano_letivo_read on ano_letivo for select to authenticated using (organization_id = public.current_org());

-- Quadro / etapas / campos: interno vê os da org; externo só os de boards
-- onde tem card atribuído.
create policy board_read on board for select to authenticated
  using (public.can_see_board(id));

create policy stage_read on stage for select to authenticated
  using (public.can_see_board(board_id));

create policy field_definition_read on field_definition for select to authenticated
  using (public.can_see_board(board_id));

create policy workflow_rule_read on workflow_rule for select to authenticated
  using (public.can_see_board(board_id));

-- Card e tudo pendurado nele: visível se can_see_card.
create policy card_read on card for select to authenticated
  using (public.can_see_card(id));

create policy field_value_read on field_value for select to authenticated
  using (public.can_see_card(card_id));

create policy checklist_read on checklist for select to authenticated
  using (public.can_see_card(card_id));

create policy checklist_item_read on checklist_item for select to authenticated
  using (exists (select 1 from checklist c
                 where c.id = checklist_item.checklist_id and public.can_see_card(c.card_id)));

create policy attachment_read on attachment for select to authenticated
  using (public.can_see_card(card_id));

create policy emenda_read on emenda for select to authenticated
  using (public.can_see_card(card_id));

create policy comment_read on comment for select to authenticated
  using (public.can_see_card(card_id));

create policy assignment_read on assignment for select to authenticated
  using (public.can_see_card(card_id));

create policy approval_read on approval for select to authenticated
  using (public.can_see_card(card_id));

create policy activity_read on activity for select to authenticated
  using (card_id is not null and public.can_see_card(card_id));

-- Volume (agregação): interno da org. Externo não precisa no MVP.
create policy volume_read on volume for select to authenticated
  using (public.is_internal() and organization_id = public.current_org());
create policy volume_card_read on volume_card for select to authenticated
  using (exists (select 1 from card c where c.id = volume_card.card_id and public.can_see_card(c.id)));

-- Canais e mensagens: só membros do canal.
create policy channel_read on channel for select to authenticated
  using (exists (select 1 from channel_member m
                 where m.channel_id = channel.id and m.user_id = auth.uid()));

create policy channel_member_read on channel_member for select to authenticated
  using (channel_member.user_id = auth.uid()
         or exists (select 1 from channel_member m
                    where m.channel_id = channel_member.channel_id and m.user_id = auth.uid()));

create policy message_read on message for select to authenticated
  using (exists (select 1 from channel_member m
                 where m.channel_id = message.channel_id and m.user_id = auth.uid()));

-- Notificações: só as do próprio usuário.
create policy notification_read on notification for select to authenticated
  using (user_id = auth.uid());
