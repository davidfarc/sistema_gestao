-- ============================================================================
-- 0062_meeting_survey.sql — Pesquisa de satisfação depois da reunião
--
-- Fluxo (pipeline de Reuniões, configurado em Opções do pipeline):
--   1. O card entra na etapa que DISPARA (ex.: "Realizada"): nasce uma pesquisa
--      "a confirmar" com o telefone e o nome do participante (campos do card), e
--      quem confirma (ex.: a secretaria) recebe pelo Luix o pedido de conferência.
--   2. A secretaria confirma (ou corrige) pelo WhatsApp: a pesquisa vira
--      "enviada", ganha um link único e a mensagem vai para o participante.
--      O site move o card para "Aguardando feedback" (CardService.move).
--   3. O participante responde na página do link: "respondida", e o site move o
--      card para "Feedback recebido", com as respostas num comentário.
--
-- Nos testes a mensagem ao participante sai pelo número do Luix (Evolution);
-- depois, pela API oficial da Meta, sem mudar o resto.
--
-- Aditiva e idempotente. Única mudança em algo existente: `whatsapp_outbox.user_id`
-- deixa de ser obrigatório (mensagem para quem não é da equipe).
-- ============================================================================

-- ── Configuração por pipeline ───────────────────────────────────────────────
-- { "enabled": true, "trigger_stage_id", "waiting_stage_id", "done_stage_id",
--   "phone_field_id", "name_field_id" (opcional), "confirmer_ids": [uuid…] }
alter table board add column if not exists survey_config jsonb;

-- ── Pesquisas ───────────────────────────────────────────────────────────────
create table if not exists meeting_survey (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  card_id         uuid not null references card(id) on delete cascade,
  participant     text not null default '',
  phone           text not null default '',
  status          text not null default 'confirmar'
                  check (status in ('confirmar', 'enviada', 'respondida', 'cancelada')),
  token           text unique,
  confirmed_by    uuid references app_user(id),
  confirmed_at    timestamptz,
  sent_at         timestamptz,
  answered_at     timestamptz,
  answers         jsonb,
  created_at      timestamptz not null default now()
);
-- Uma pesquisa em aberto por card.
create unique index if not exists meeting_survey_open_idx on meeting_survey (card_id)
  where status in ('confirmar', 'enviada');
create index if not exists meeting_survey_phone_idx on meeting_survey (phone, sent_at desc);

alter table meeting_survey enable row level security;
alter table meeting_survey force row level security;
revoke all on meeting_survey from anon, authenticated;
grant select on meeting_survey to authenticated;
drop policy if exists meeting_survey_read on meeting_survey;
create policy meeting_survey_read on meeting_survey for select to authenticated
  using (public.can_see_card(card_id));

-- Mensagem para quem não é da equipe (o participante da reunião).
alter table whatsapp_outbox alter column user_id drop not null;

-- ── Telefone: só dígitos, com +55 quando vier sem o país ────────────────────
create or replace function public.survey_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when d is null or d = '' then ''
    when length(d) in (10, 11) then '+55' || d
    when length(d) in (12, 13) and d like '55%' then '+' || d
    else '+' || d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- ── 1. O card entrou na etapa que dispara ───────────────────────────────────
create or replace function public.meeting_survey_on_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg     jsonb;
  b       record;
  v_phone text;
  v_name  text;
  v_uid   text;
  v_body  text;
begin
  if new.stage_id is not distinct from old.stage_id or new.archived_at is not null then return new; end if;
  select id, name, survey_config into b from board where id = new.board_id;
  cfg := b.survey_config;
  if cfg is null or coalesce((cfg->>'enabled')::boolean, false) is not true then return new; end if;
  if new.stage_id::text is distinct from cfg->>'trigger_stage_id' then return new; end if;
  if exists (select 1 from meeting_survey where card_id = new.id and status in ('confirmar', 'enviada')) then
    return new;
  end if;

  -- Telefone em propriedade de texto ou de número.
  select coalesce(value_text, value_number::bigint::text) into v_phone from field_value
   where card_id = new.id and field_definition_id::text = cfg->>'phone_field_id';
  select coalesce(value_text, '') into v_name from field_value
   where card_id = new.id and field_definition_id::text = cfg->>'name_field_id';
  v_name := coalesce(nullif(trim(v_name), ''), new.title);
  v_phone := public.survey_phone(v_phone);

  insert into meeting_survey (organization_id, card_id, participant, phone)
  values (new.organization_id, new.id, left(v_name, 200), v_phone);

  v_body := format(
    E'Pesquisa da reunião #%s (%s): %s\nParticipante: %s\nTelefone: %s\n\nPosso enviar a pesquisa de satisfação para este número?\n1 - Sim, está certo\n2 - Corrigir (mande o número certo)',
    new.number, b.name, new.title, v_name,
    case when v_phone = '' then '(sem telefone no card)' else v_phone end);
  for v_uid in select jsonb_array_elements_text(coalesce(cfg->'confirmer_ids', '[]'::jsonb)) loop
    perform public.whatsapp_enqueue(v_uid::uuid, new.id, 'pesquisa_confirmar', v_body);
  end loop;
  return new;
end$$;

drop trigger if exists meeting_survey_on_stage on card;
create trigger meeting_survey_on_stage after update of stage_id on card
  for each row execute function public.meeting_survey_on_stage();

-- ── 2. Ferramentas do Luix para quem confirma ───────────────────────────────
-- Roda como a pessoa (p_user). Só quem está em "confirmer_ids" do pipeline age.
create or replace function public.whatsapp_survey(p_user uuid, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  args    jsonb := coalesce(p_args, '{}'::jsonb);
  s       record;
  v_num   bigint;
  v_phone text;
  v_token text;
  v_list  jsonb;
begin
  if not exists (select 1 from app_user where id = p_user and archived_at is null and is_internal) then
    return jsonb_build_object('erro', 'Pessoa não encontrada.');
  end if;

  if p_tool = 'pesquisas_pendentes' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero', c.number, 'pipeline', b.name, 'pipeline_id', b.id, 'reuniao', c.title,
             'participante', m.participant, 'telefone', nullif(m.phone, ''),
             'desde', to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
             order by m.created_at), '[]'::jsonb)
      into v_list
      from meeting_survey m join card c on c.id = m.card_id join board b on b.id = c.board_id
     where m.status = 'confirmar' and c.archived_at is null
       and coalesce(b.survey_config->'confirmer_ids', '[]'::jsonb) ? p_user::text;
    return jsonb_build_object('pendentes', v_list);
  end if;

  if p_tool = 'confirmar_telefone' then
    v_num := nullif(regexp_replace(coalesce(args->>'numero', ''), '\D', '', 'g'), '')::bigint;
    select m.*, c.number, c.board_id, c.title, b.name as board_name, b.survey_config as cfg
      into s
      from meeting_survey m join card c on c.id = m.card_id join board b on b.id = c.board_id
     where m.status = 'confirmar' and c.number = v_num and c.archived_at is null
       and coalesce(b.survey_config->'confirmer_ids', '[]'::jsonb) ? p_user::text
       and (coalesce(args->>'pipeline_id', '') = '' or b.id::text = args->>'pipeline_id')
     order by m.created_at desc limit 1;
    if s.id is null then
      return jsonb_build_object('erro', 'Não achei pesquisa a confirmar com esse número de reunião para você.');
    end if;

    v_phone := coalesce(nullif(public.survey_phone(args->>'telefone'), ''), s.phone);
    if v_phone !~ '^\+[1-9][0-9]{11,13}$' then
      return jsonb_build_object('erro', 'Telefone inválido. Peça o número com DDD, por exemplo (81) 99999-0000.');
    end if;
    if coalesce((args->>'confirmado_pela_pessoa')::boolean, false) is not true then
      return jsonb_build_object('erro', 'Antes, mostre o telefone à pessoa e peça a confirmação.');
    end if;

    -- Corrigido: o card passa a ter o número certo.
    if v_phone <> s.phone and s.cfg->>'phone_field_id' is not null then
      if (select type from field_definition where id = (s.cfg->>'phone_field_id')::uuid) = 'number' then
        insert into field_value (field_definition_id, card_id, organization_id, value_number)
        values ((s.cfg->>'phone_field_id')::uuid, s.card_id, s.organization_id, ltrim(v_phone, '+')::numeric)
        on conflict (field_definition_id, card_id) do update set value_number = excluded.value_number;
      else
        insert into field_value (field_definition_id, card_id, organization_id, value_text)
        values ((s.cfg->>'phone_field_id')::uuid, s.card_id, s.organization_id, v_phone)
        on conflict (field_definition_id, card_id) do update set value_text = excluded.value_text;
      end if;
    end if;

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update meeting_survey
       set phone = v_phone, status = 'enviada', token = v_token,
           confirmed_by = p_user, confirmed_at = now(), sent_at = now()
     where id = s.id;

    -- %APP_URL% é trocado pelo endereço do site na hora do envio (Worker).
    insert into whatsapp_outbox (organization_id, user_id, card_id, kind, phone, body)
    values (s.organization_id, null, s.card_id, 'pesquisa', v_phone, format(
      E'Olá, %s! Obrigado pela reunião com a escola Eccoprime (%s).\nSua opinião nos ajuda a melhorar: pode responder a uma pesquisa rápida, de 1 minuto?\n%%APP_URL%%/pesquisa/%s',
      split_part(s.participant, ' ', 1), s.board_name, v_token));

    insert into comment (organization_id, card_id, author_id, body)
    values (s.organization_id, s.card_id, p_user,
            format('Telefone %s confirmado pelo WhatsApp; pesquisa de satisfação enviada.', v_phone));

    return jsonb_build_object('ok', true, 'numero', s.number, 'card_id', s.card_id,
                              'participante', s.participant, 'telefone', v_phone,
                              'etapa_aguardando', s.cfg->>'waiting_stage_id');
  end if;

  return jsonb_build_object('erro', 'Ferramenta desconhecida.');
end$$;

-- ── 3. Resposta pelo link (chamada pelo site, com a chave de serviço) ───────
create or replace function public.meeting_survey_answer(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s record; v_text text;
begin
  select m.*, b.survey_config as cfg into s
    from meeting_survey m join card c on c.id = m.card_id join board b on b.id = c.board_id
   where m.token = p_token and length(coalesce(p_token, '')) = 64;
  if s.id is null then return jsonb_build_object('erro', 'link inválido'); end if;
  if s.status = 'respondida' then return jsonb_build_object('erro', 'já respondida'); end if;
  if s.status <> 'enviada' then return jsonb_build_object('erro', 'pesquisa encerrada'); end if;

  update meeting_survey set status = 'respondida', answered_at = now(), answers = p_answers where id = s.id;
  v_text := format(E'Pesquisa respondida por %s:\nNota: %s de 5\nO assunto foi resolvido? %s\nComentário: %s',
                   s.participant, coalesce(p_answers->>'nota', '-'), coalesce(p_answers->>'resolvido', '-'),
                   coalesce(nullif(p_answers->>'comentario', ''), '-'));
  insert into comment (organization_id, card_id, author_id, body)
  values (s.organization_id, s.card_id, s.confirmed_by, left(v_text, 4000));
  return jsonb_build_object('ok', true, 'card_id', s.card_id, 'confirmed_by', s.confirmed_by,
                            'etapa_recebido', s.cfg->>'done_stage_id');
end$$;

-- ── Quem recebeu a pesquisa e responde no WhatsApp não recebe as orientações
--    de "número não cadastrado": a conversa fica em silêncio. ───────────────
create or replace function public.whatsapp_inbound(
  p_phone text, p_phones text[], p_provider_id text, p_kind text, p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_new integer;
  v_recent integer;
  v_last timestamptz;
  v_survey boolean;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' or coalesce(p_provider_id, '') = '' then
    raise exception 'argumentos inválidos';
  end if;

  select a.id, a.name, a.email, a.organization_id into u
    from user_phone p join app_user a on a.id = p.user_id
   where p.phone = any (p_phones || p_phone)
     and a.archived_at is null and a.is_internal
   limit 1;

  insert into whatsapp_message (organization_id, user_id, phone, direction, kind, body, provider_id)
  values (u.organization_id, u.id, p_phone, 'in',
          case when p_kind in ('text', 'audio', 'image', 'other') then p_kind else 'other' end,
          case when u.id is null then '' else left(coalesce(p_body, ''), 4000) end,
          p_provider_id)
  on conflict (provider_id) where provider_id is not null do nothing;
  get diagnostics v_new = row_count;

  select count(*) into v_recent from whatsapp_message
   where phone = p_phone and direction = 'in' and created_at > now() - interval '1 hour';
  select max(created_at) into v_last from whatsapp_message
   where phone = p_phone and direction = 'out' and error is null;
  v_survey := u.id is null and exists (
    select 1 from meeting_survey
     where phone = any (p_phones || p_phone) and sent_at > now() - interval '30 days');

  delete from whatsapp_message where created_at < now() - interval '90 days';

  return jsonb_build_object(
    'duplicada', v_new = 0,
    'usuario', case when u.id is null then null
                    else jsonb_build_object('id', u.id, 'nome', coalesce(nullif(u.name, ''), u.email)) end,
    'recentes', v_recent,
    'respostas_sem_cadastro', case when v_survey then 999 else (
      select count(*) from whatsapp_message
       where phone = p_phone and direction = 'out' and user_id is null and error is null) end,
    'minutos_desde_resposta', case when v_last is null then null
                                   else floor(extract(epoch from now() - v_last) / 60)::integer end);
end$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.meeting_survey_on_stage()',
    'public.whatsapp_survey(uuid, text, jsonb)',
    'public.meeting_survey_answer(text, jsonb)',
    'public.whatsapp_inbound(text, text[], text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
