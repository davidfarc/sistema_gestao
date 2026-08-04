-- Módulo "Gestão de Vila" (salas): salas, alunos, equipe, rotina diária e
-- busca ativa da escola.
--
-- Vinha do Firebase RTDB do projeto `eccoprime-salas`, cujas regras estavam
-- 100% ABERTAS (.read/.write: true, sem autenticação) — os dados de 419 alunos
-- ficavam expostos a quem tivesse a URL. Aqui entram atrás de RLS + login.
--
-- O estado é guardado como UM documento jsonb, preservando a forma do RTDB
-- (`EscolaSimState`). Isso mantém as telas e o modo Simulado funcionando como
-- estão, e as escritas continuam GRANULARES por caminho (sem sobrescrever o
-- documento inteiro, evitando clobber entre dois usuários).
-- Se um dia relatórios exigirem SQL, dá para normalizar em tabelas sem mexer na UI.

create table if not exists sala_state (
  organization_id uuid primary key references organization(id) on delete cascade,
  state           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

alter table sala_state enable row level security;
alter table sala_state force row level security;

drop policy if exists sala_state_read on sala_state;
create policy sala_state_read on sala_state for select to authenticated
  using (organization_id = public.current_org() and public.is_internal());

grant select on sala_state to authenticated;

-- ── Escrita por caminho ──────────────────────────────────────────────────────
-- `jsonb_set` só cria o ÚLTIMO nível; se um intermediário não existe (ex.: uma
-- data nova em dailyRoutine), a escrita seria descartada em silêncio. Este
-- helper garante os níveis do caminho antes de gravar.
create or replace function public.jsonb_set_deep(target jsonb, p_path text[], val jsonb)
returns jsonb language plpgsql immutable as $$
declare
  i int;
  sub text[];
begin
  if target is null then target := '{}'::jsonb; end if;
  for i in 1 .. coalesce(array_length(p_path, 1), 0) - 1 loop
    sub := p_path[1:i];
    if target #> sub is null or jsonb_typeof(target #> sub) not in ('object', 'array') then
      target := jsonb_set(target, sub, '{}'::jsonb, true);
    end if;
  end loop;
  return jsonb_set(target, p_path, val, true);
end$$;

-- Grava (ou remove, quando p_value é null) um caminho do estado.
create or replace function public.sala_state_set(p_org uuid, p_path text[], p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sala_state (organization_id, state)
  values (p_org, '{}'::jsonb)
  on conflict (organization_id) do nothing;

  if p_value is null then
    update sala_state
      set state = state #- p_path, updated_at = now()
      where organization_id = p_org;
  else
    update sala_state
      set state = public.jsonb_set_deep(state, p_path, p_value), updated_at = now()
      where organization_id = p_org;
  end if;
end$$;
