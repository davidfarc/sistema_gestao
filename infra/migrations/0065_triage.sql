-- ============================================================================
-- 0065_triage.sql — Triagem das mensagens das famílias (SPEC-FASE2 §F)
--
-- Primeira fonte: o WhatsApp institucional da Gestão de Vila (instância
-- "Gestão Vila-2" da Evolution), SÓ LEITURA. O Worker `ecco-triagem` grava cada
-- mensagem (da família e da equipe), um modelo classifica cada conversa, e:
--   - P1 e P2: aviso NA HORA para a coordenação do segmento (pelo Luix);
--   - resumo às 7h30 (dias úteis) para a coordenação (seu segmento) e para a
--     direção (todos os segmentos); P3 entra no resumo semanal (segunda, 7h30).
-- Horário útil: segunda a sexta, 7h às 17h (São Paulo). Prazo do WhatsApp:
-- 4 horas úteis sem resposta da equipe.
-- Segmento pela turma do aluno (cadastro de responsáveis): Little Kids, Kids e
-- Junior 1 → Infantil (Vila 1); Junior 2 a 5 → Fundamental 1; Junior 6 a 12 →
-- Fundamental 2 e Médio.
--
-- Separado do Luix: tabelas próprias, sem acesso pelo navegador; o Luix só
-- entrega os avisos (fila whatsapp_outbox).
-- Aditiva e idempotente. Aplicar DEPOIS da 0064.
-- ============================================================================

-- ── Quem recebe ─────────────────────────────────────────────────────────────
create table if not exists triage_recipient (
  organization_id uuid not null references organization(id),
  scope           text not null check (scope in ('infantil', 'fund1', 'fund2em', 'direcao')),
  user_id         uuid not null references app_user(id) on delete cascade,
  primary key (organization_id, scope, user_id)
);

-- ── Conversas (episódios) e mensagens ───────────────────────────────────────
create table if not exists triage_episode (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  source          text not null,                 -- 'whatsapp_vila', depois 'agendaedu'
  contact         text not null,                 -- telefone da família (+55…)
  student_key     text,
  student_name    text not null default '',
  room            text not null default '',
  guardian_name   text not null default '',
  segment         text,                          -- infantil | fund1 | fund2em | null
  opened_at       timestamptz not null,
  last_at         timestamptz not null,
  last_family_at  timestamptz,
  last_school_at  timestamptz,
  -- Classificação (modelo) — refeita quando chega mensagem nova da família.
  classified_upto timestamptz,
  assunto         text[] not null default '{}',
  acao            text,
  gravidade       text,
  risco           text,
  queixa_formal   boolean not null default false,
  confianca       text,
  motivo          text not null default '',
  modelo          text,
  prompt_versao   text,
  -- Decisão (regra fixa) e avisos já dados.
  prioridade      text check (prioridade in ('P1', 'P2', 'P3')),
  alerted_p1_at   timestamptz,
  alerted_p2_at   timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists triage_episode_contact_idx on triage_episode (source, contact, last_at desc);
create index if not exists triage_episode_open_idx on triage_episode (last_at desc);

create table if not exists triage_message (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  episode_id      uuid not null references triage_episode(id) on delete cascade,
  provider_id     text not null unique,
  from_family     boolean not null,
  kind            text not null default 'text',
  body            text not null default '',
  at              timestamptz not null
);
create index if not exists triage_message_episode_idx on triage_message (episode_id, at);

-- Resumos já enviados (um por pessoa, por dia e por tipo).
create table if not exists triage_digest (
  organization_id uuid not null references organization(id),
  day             date not null,
  kind            text not null,                 -- 'diario' | 'semanal'
  user_id         uuid not null references app_user(id) on delete cascade,
  primary key (organization_id, day, kind, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['triage_recipient', 'triage_episode', 'triage_message', 'triage_digest'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end$$;

-- ── Segmento pela turma ─────────────────────────────────────────────────────
create or replace function public.triage_segment(p_room text)
returns text
language sql
immutable
as $$
  select case
    when k ~ '^lk' or k ~ '^k([0-9]|[a-z]?$)' then 'infantil'
    when k ~ '^j1($|[a-z])' then 'infantil'
    when k ~ '^j([2-5])($|[a-z])' then 'fund1'
    when k ~ '^j([6-9]|1[0-2])($|[a-z])' then 'fund2em'
    else null end
  from (select public.sala_room_key(coalesce(p_room, '')) as k) x
$$;

create or replace function public.triage_segment_label(p text)
returns text language sql immutable as $$
  select case p when 'infantil' then 'Infantil (Vila 1)' when 'fund1' then 'Fundamental 1'
                when 'fund2em' then 'Fundamental 2 e Médio' else 'Sem segmento' end
$$;

-- ── Minutos úteis entre dois instantes (seg–sex, 7h–17h, São Paulo) ─────────
create or replace function public.business_minutes(p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
as $$
  select coalesce(sum(greatest(0, extract(epoch from
           least(p_to, (d + time '17:00') at time zone 'America/Sao_Paulo')
         - greatest(p_from, (d + time '07:00') at time zone 'America/Sao_Paulo')) / 60)), 0)::integer
    from generate_series((p_from at time zone 'America/Sao_Paulo')::date,
                         (p_to at time zone 'America/Sao_Paulo')::date, interval '1 day') g(d0),
         lateral (select g.d0::date as d) x
   where p_to > p_from and extract(isodow from d) between 1 and 5
$$;

-- ── Prioridade (regra fixa, sem modelo) ─────────────────────────────────────
create or replace function public.triage_priority(e triage_episode)
returns text
language sql
stable
as $$
  select case
    when e.acao is null then null
    when e.gravidade = 'alta' or e.risco = 'alto' or e.queixa_formal then 'P1'
    when e.risco = 'medio' or e.acao = 'exige_escalonamento' then 'P2'
    when e.acao = 'pede_resposta'
         and (e.last_school_at is null or e.last_school_at < e.last_family_at)
         and public.business_minutes(e.last_family_at, now()) >= 240 then 'P2'
    when e.gravidade = 'atencao' or e.assunto && array['convivencia', 'saude', 'socioemocional'] then 'P3'
    else null end
$$;

-- ── Aviso na hora para a coordenação do segmento ────────────────────────────
create or replace function public.triage_alert(p_episode uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e triage_episode; v_uid uuid; v_body text; v_hours text;
begin
  select * into e from triage_episode where id = p_episode;
  if e.id is null or e.prioridade not in ('P1', 'P2') then return; end if;
  if e.prioridade = 'P1' and e.alerted_p1_at is not null then return; end if;
  if e.prioridade = 'P2' and (e.alerted_p2_at is not null or e.alerted_p1_at is not null) then return; end if;

  v_hours := case when e.last_family_at is null then '-' else
    round(public.business_minutes(e.last_family_at, now()) / 60.0, 1)::text || 'h úteis' end;
  v_body := format(
    E'Triagem · %s · WhatsApp da Gestão de Vila\nAluno: %s%s\nResponsável: %s\n%s\nÚltima mensagem da família há %s%s.\nResponda pelo WhatsApp da Vila.',
    case e.prioridade when 'P1' then 'P1 (grave)' else 'P2 (precisa de resposta)' end,
    coalesce(nullif(e.student_name, ''), 'não identificado'),
    case when e.room <> '' then ' (' || e.room || ')' else '' end,
    coalesce(nullif(e.guardian_name, ''), e.contact),
    case when e.motivo <> '' then 'O que houve: ' || e.motivo else 'Assunto: ' || coalesce(array_to_string(e.assunto, ', '), '-') end,
    v_hours,
    case when e.last_school_at is null or e.last_school_at < e.last_family_at then ', sem resposta da equipe' else '' end);

  for v_uid in select user_id from triage_recipient
                where organization_id = e.organization_id and scope = coalesce(e.segment, 'infantil') loop
    perform public.whatsapp_enqueue(v_uid, null, 'triagem_' || lower(e.prioridade), v_body);
  end loop;
  update triage_episode
     set alerted_p1_at = case when e.prioridade = 'P1' then now() else alerted_p1_at end,
         alerted_p2_at = case when e.prioridade = 'P2' then now() else alerted_p2_at end
   where id = e.id;
end$$;

-- ── Grava uma mensagem (Worker, chave de serviço) ───────────────────────────
-- Conversa nova depois de 20 horas de silêncio, como no prompt do classificador.
create or replace function public.triage_record(
  p_source text, p_phone text, p_phones text[], p_provider_id text,
  p_from_family boolean, p_kind text, p_body text, p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  e      triage_episode;
  g      record;
  v_at   timestamptz := least(coalesce(p_at, now()), now());
begin
  if coalesce(p_provider_id, '') = '' or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'argumentos inválidos';
  end if;
  if exists (select 1 from triage_message where provider_id = p_provider_id) then
    return jsonb_build_object('repetida', true);
  end if;
  -- A escola é uma organização só; vem do cadastro (responsável ou quem recebe).
  v_org := coalesce(
    (select organization_id from student_guardian where phone = any (p_phones || p_phone) limit 1),
    (select organization_id from triage_recipient limit 1),
    (select id from organization order by created_at limit 1));

  select * into e from triage_episode
   where source = p_source and contact = any (p_phones || p_phone) and last_at > v_at - interval '20 hours'
   order by last_at desc limit 1;

  if e.id is null then
    -- Quem é: o telefone no cadastro de responsáveis (ActiveSoft).
    select sg.student_key, sg.student_name, sg.room, sg.name into g
      from student_guardian sg
     where sg.organization_id = v_org and sg.phone = any (p_phones || p_phone)
     order by sg.slot limit 1;
    insert into triage_episode (organization_id, source, contact, student_key, student_name, room,
                                guardian_name, segment, opened_at, last_at)
    values (v_org, p_source, p_phone, g.student_key, coalesce(g.student_name, ''), coalesce(g.room, ''),
            coalesce(g.name, ''), public.triage_segment(g.room), v_at, v_at)
    returning * into e;
  end if;

  insert into triage_message (organization_id, episode_id, provider_id, from_family, kind, body, at)
  values (v_org, e.id, p_provider_id, p_from_family,
          case when p_kind in ('text', 'audio', 'image', 'other') then p_kind else 'other' end,
          left(coalesce(p_body, ''), 4000), v_at);

  update triage_episode
     set last_at = greatest(last_at, v_at),
         last_family_at = case when p_from_family then greatest(coalesce(last_family_at, v_at), v_at) else last_family_at end,
         last_school_at = case when not p_from_family then greatest(coalesce(last_school_at, v_at), v_at) else last_school_at end
   where id = e.id;
  return jsonb_build_object('ok', true, 'episodio', e.id);
end$$;

-- ── Conversas para classificar: mensagem nova da família, 10 min de calma ───
create or replace function public.triage_to_classify(p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
    select jsonb_build_object(
             'episodio', e.id, 'upto', e.last_at,
             'canal', case e.source when 'whatsapp_vila' then 'WhatsApp da Gestão de Vila' else e.source end,
             'turma', nullif(e.room, ''),
             'turnos', (select coalesce(jsonb_agg(jsonb_build_object(
                          'de', case when m.from_family then 'FAMILIA' else 'ESCOLA' end,
                          'quando', to_char(m.at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                          'texto', case when m.body = '' then null else m.body end,
                          'anexo', case when m.kind in ('audio', 'image', 'other') then m.kind end)
                          order by m.at), '[]'::jsonb)
                          from (select * from triage_message where episode_id = e.id order by at desc limit 40) m)) as j
      from triage_episode e
     where e.last_family_at is not null
       and e.last_family_at > coalesce(e.classified_upto, '-infinity'::timestamptz)
       and e.last_at < now() - interval '10 minutes'
       and e.last_at > now() - interval '30 days'
     order by e.last_family_at
     limit least(greatest(p_limit, 1), 30)) x
$$;

-- ── Grava a classificação, decide a prioridade e avisa ──────────────────────
create or replace function public.triage_save(p_episode uuid, p_upto timestamptz, p_label jsonb, p_model text, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e triage_episode; v_assunto text[];
begin
  v_assunto := array(select distinct a from jsonb_array_elements_text(coalesce(p_label->'assunto', '[]'::jsonb)) a
                      where a in ('pedagogico', 'rotina_evento', 'material', 'ausencia', 'saude', 'convivencia',
                                  'comportamento', 'alimentacao', 'socioemocional', 'secretaria_financeiro', 'outro')
                      order by a);
  update triage_episode set
    classified_upto = p_upto,
    assunto = v_assunto,
    acao = case when p_label->>'acao' in ('pede_resposta', 'informativo', 'encerrado', 'exige_escalonamento') then p_label->>'acao' else 'pede_resposta' end,
    gravidade = case when p_label->>'gravidade' in ('nenhuma', 'atencao', 'alta') then p_label->>'gravidade' else 'atencao' end,
    risco = case when p_label->>'risco_escalar' in ('baixo', 'medio', 'alto') then p_label->>'risco_escalar' else 'baixo' end,
    queixa_formal = coalesce((p_label->>'queixa_formal')::boolean, false),
    confianca = case when p_label->>'confianca' in ('alta', 'media', 'baixa') then p_label->>'confianca' else 'baixa' end,
    motivo = left(coalesce(p_label->>'motivo_direcao', ''), 400),
    modelo = left(p_model, 80), prompt_versao = left(p_version, 20)
  where id = p_episode
  returning * into e;
  if e.id is null then return jsonb_build_object('erro', 'episódio não encontrado'); end if;

  update triage_episode set prioridade = public.triage_priority(e) where id = e.id returning * into e;
  perform public.triage_alert(e.id);
  return jsonb_build_object('ok', true, 'prioridade', e.prioridade);
end$$;

-- ── A cada 5 minutos: o relógio das 4 horas úteis e a faxina ────────────────
create or replace function public.triage_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare e triage_episode; n integer := 0; v_p text;
begin
  for e in select * from triage_episode
            where acao is not null and last_at > now() - interval '30 days'
              and (prioridade is distinct from 'P1') loop
    v_p := public.triage_priority(e);
    if v_p is distinct from e.prioridade then
      update triage_episode set prioridade = v_p where id = e.id;
      if v_p in ('P1', 'P2') then perform public.triage_alert(e.id); n := n + 1; end if;
    end if;
  end loop;
  -- Texto das mensagens: só 30 dias. Fica a classificação.
  update triage_message set body = '' where at < now() - interval '30 days' and body <> '';
  return n;
end$$;

-- ── Resumos das 7h30 ────────────────────────────────────────────────────────
-- Diário (dias úteis): coordenação = o seu segmento; direção = todos.
-- Semanal (segunda): P3 da semana para a coordenação.
create or replace function public.triage_digests(p_weekly boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_day  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_kind text := case when p_weekly then 'semanal' else 'diario' end;
  v_body text;
  v_list text;
  n      integer := 0;
begin
  for r in select distinct tr.organization_id, tr.user_id, tr.scope from triage_recipient tr loop
    if exists (select 1 from triage_digest d where d.organization_id = r.organization_id and d.day = v_day
                and d.kind = v_kind and d.user_id = r.user_id) then continue; end if;

    select string_agg(format('- %s · %s%s · %s%s', e.prioridade,
                             coalesce(nullif(e.student_name, ''), 'não identificado'),
                             case when e.room <> '' then ' (' || e.room || ')' else '' end,
                             coalesce(nullif(e.motivo, ''), array_to_string(e.assunto, ', ')),
                             case when e.last_school_at is null or e.last_school_at < e.last_family_at
                                  then ' · sem resposta há ' || round(public.business_minutes(e.last_family_at, now()) / 60.0) || 'h úteis'
                                  else '' end),
                      E'\n' order by e.prioridade, e.last_family_at)
      into v_list
      from (select * from triage_episode e
             where e.organization_id = r.organization_id
               and (r.scope = 'direcao' or coalesce(e.segment, 'infantil') = r.scope)
               and case when p_weekly then e.prioridade = 'P3' and e.last_at > now() - interval '7 days'
                        else e.prioridade in ('P1', 'P2') and e.last_at > now() - interval '30 days'
                             and (e.prioridade = 'P1' and e.last_at > now() - interval '3 days'
                                  or e.last_school_at is null or e.last_school_at < e.last_family_at) end
             order by e.prioridade, e.last_family_at limit 15) e;

    if r.scope = 'direcao' and not p_weekly then
      v_body := format(E'Resumo da triagem · %s\n%s\n\nPendências P2 por segmento: %s',
        to_char(v_day, 'DD/MM'),
        coalesce(v_list, 'Nenhum caso P1 ou P2 em aberto.'),
        coalesce((select string_agg(public.triage_segment_label(s) || ' ' || c, ', ')
                    from (select segment s, count(*) c from triage_episode
                           where organization_id = r.organization_id and prioridade = 'P2'
                             and (last_school_at is null or last_school_at < last_family_at)
                             and last_at > now() - interval '30 days' group by segment) z), 'nenhuma'));
    else
      v_body := format(E'%s · %s · %s\n%s',
        case when p_weekly then 'Resumo semanal da triagem (P3)' else 'Resumo da triagem' end,
        public.triage_segment_label(r.scope), to_char(v_day, 'DD/MM'),
        coalesce(v_list, case when p_weekly then 'Nada para acompanhar esta semana.' else 'Nenhuma pendência P1 ou P2.' end));
    end if;

    perform public.whatsapp_enqueue(r.user_id, null, 'triagem_resumo', v_body);
    insert into triage_digest (organization_id, day, kind, user_id) values (r.organization_id, v_day, v_kind, r.user_id)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.triage_alert(uuid)',
    'public.triage_record(text, text, text[], text, boolean, text, text, timestamptz)',
    'public.triage_to_classify(integer)',
    'public.triage_save(uuid, timestamptz, jsonb, text, text)',
    'public.triage_tick()',
    'public.triage_digests(boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
