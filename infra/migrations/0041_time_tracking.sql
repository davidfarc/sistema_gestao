-- ============================================================================
-- 0041_time_tracking.sql — Tempo por tarefa e "Minhas demandas" (SPEC-FASE2 §E.2)
--
-- 1. Opções por pipeline (ligadas na configuração do pipeline):
--      board.my_tasks       → oferece a visão "Minhas demandas"
--      board.time_tracking  → mostra o cronômetro nos cards
-- 2. `time_entry`: cada período em que alguém trabalhou num card (início e
--    fim). Fim nulo = cronômetro ligado. Uma pessoa tem no máximo UM período
--    aberto (índice único parcial): iniciar outra tarefa pausa a anterior.
--    Não é registro de jornada: mede o tempo gasto em cada tarefa.
-- 3. Permissão `time:read` (Gestor Master e Gestor): ver o tempo da equipe e
--    exportar a planilha. Sem ela, cada pessoa vê só o próprio tempo.
-- 4. Funções `time_start` e `time_stop`: ligar e pausar numa transação só.
--    Executáveis só pela chave de serviço; o servidor confere quem chama.
--
-- Só cria colunas, tabela, índices e funções, e concede a permissão.
-- Idempotente.
-- ============================================================================

alter table board add column if not exists my_tasks boolean not null default false;
alter table board add column if not exists time_tracking boolean not null default false;

create table if not exists time_entry (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  user_id         uuid not null references app_user(id) on delete cascade,
  -- Pipeline em que o card estava quando o tempo foi gasto (o card pode mudar
  -- de pipeline depois; o relatório conta onde o trabalho aconteceu).
  board_id        uuid not null references board(id) on delete cascade,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);

create unique index if not exists time_entry_one_running_idx
  on time_entry (user_id) where ended_at is null;
create index if not exists time_entry_card_idx on time_entry (card_id, started_at);
create index if not exists time_entry_user_idx on time_entry (user_id, started_at desc);
create index if not exists time_entry_org_period_idx on time_entry (organization_id, started_at);

alter table time_entry enable row level security;

-- Cada pessoa lê o próprio tempo; quem tem `time:read` lê o da equipe nos
-- cards que enxerga. Escrita só pelo servidor.
drop policy if exists time_entry_read on time_entry;
create policy time_entry_read on time_entry for select to authenticated
  using (
    user_id = auth.uid()
    or (public.has_permission('time:read') and public.can_see_card(card_id))
  );

revoke all on time_entry from anon;
revoke insert, update, delete on time_entry from authenticated;

update role
   set permissions = permissions || '["time:read"]'::jsonb
 where slug in ('master', 'gestor')
   and archived_at is null
   and not permissions @> '["time:read"]'::jsonb;

-- Liga o cronômetro de `p_user` em `p_card`, pausando o que estiver ligado.
create or replace function public.time_start(p_user uuid, p_card uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        card%rowtype;
  v_now    timestamptz := now();
  v_paused uuid;
  v_id     uuid;
begin
  select * into c from card where id = p_card and archived_at is null;
  if not found then raise exception 'card_not_found'; end if;

  -- Já está ligado neste card: nada a fazer.
  select id into v_id from time_entry
   where user_id = p_user and ended_at is null and card_id = p_card;
  if found then
    return jsonb_build_object('entryId', v_id, 'pausedCardId', null);
  end if;

  update time_entry set ended_at = v_now
   where user_id = p_user and ended_at is null
   returning card_id into v_paused;

  insert into time_entry (organization_id, card_id, user_id, board_id, started_at)
  values (c.organization_id, p_card, p_user, c.board_id, v_now)
  returning id into v_id;

  return jsonb_build_object('entryId', v_id, 'pausedCardId', v_paused);
end$$;

-- Pausa o cronômetro de `p_user` (em qualquer card). `p_at` permite informar
-- a hora em que a pessoa de fato parou (esqueceu ligado).
create or replace function public.time_stop(p_user uuid, p_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e   time_entry%rowtype;
  v_at timestamptz := coalesce(p_at, now());
begin
  select * into e from time_entry where user_id = p_user and ended_at is null for update;
  if not found then return jsonb_build_object('stopped', false); end if;
  if v_at > now() then raise exception 'end_in_future'; end if;
  if v_at <= e.started_at then raise exception 'end_before_start'; end if;
  update time_entry
     set ended_at = v_at,
         edited_at = case when p_at is null then edited_at else now() end
   where id = e.id;
  return jsonb_build_object('stopped', true, 'cardId', e.card_id,
                            'seconds', extract(epoch from v_at - e.started_at));
end$$;

revoke all on function public.time_start(uuid, uuid) from public, anon, authenticated;
revoke all on function public.time_stop(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.time_start(uuid, uuid) to service_role;
grant execute on function public.time_stop(uuid, timestamptz) to service_role;
