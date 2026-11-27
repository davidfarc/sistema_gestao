-- ============================================================================
-- 0063_student_guardians.sql — Responsáveis dos alunos (do ActiveSoft)
--
-- 1. Cadastro de responsáveis: até 3 por aluno (responsável 1, 2 e 3: em geral
--    pai, mãe e responsável financeiro), com telefone. Preenchido pela
--    importação do ActiveSoft; só o servidor escreve.
-- 2. Luix: `buscar_responsaveis` (nome do aluno e turma), para preencher o card
--    da reunião com o responsável e o telefone do cadastro.
-- 3. Pedido de confirmação à secretaria com o texto novo, em nome de cada
--    pessoa que confirma. Se o card vier sem telefone, usa o do cadastro.
--    Opções novas da pesquisa: propriedade do aluno e da turma.
--
-- Aditiva e idempotente. Aplicar DEPOIS da 0062.
-- ============================================================================

create table if not exists student_guardian (
  organization_id uuid not null references organization(id),
  student_key     text not null,              -- id do aluno no ActiveSoft
  student_name    text not null,
  room            text not null default '',   -- turma, como no ActiveSoft
  slot            smallint not null check (slot between 1 and 3),
  name            text not null default '',
  relation        text not null default '',   -- Pai, Mãe, Responsável financeiro…
  phone           text not null default '',
  email           text not null default '',
  updated_at      timestamptz not null default now(),
  primary key (organization_id, student_key, slot)
);
create index if not exists student_guardian_name_idx on student_guardian (organization_id, student_name);

alter table student_guardian enable row level security;
alter table student_guardian force row level security;
revoke all on student_guardian from anon, authenticated;

-- ── Pedido de confirmação com o texto novo ──────────────────────────────────
create or replace function public.meeting_survey_on_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      jsonb;
  b        record;
  v_phone  text;
  v_name   text;
  v_aluno  text;
  v_turma  text;
  v_uid    text;
  v_first  text;
begin
  if new.stage_id is not distinct from old.stage_id or new.archived_at is not null then return new; end if;
  select id, name, survey_config into b from board where id = new.board_id;
  cfg := b.survey_config;
  if cfg is null or coalesce((cfg->>'enabled')::boolean, false) is not true then return new; end if;
  if new.stage_id::text is distinct from cfg->>'trigger_stage_id' then return new; end if;
  if exists (select 1 from meeting_survey where card_id = new.id and status in ('confirmar', 'enviada')) then
    return new;
  end if;

  select coalesce(value_text, value_number::bigint::text) into v_phone from field_value
   where card_id = new.id and field_definition_id::text = cfg->>'phone_field_id';
  select value_text into v_name from field_value
   where card_id = new.id and field_definition_id::text = cfg->>'name_field_id';
  select value_text into v_aluno from field_value
   where card_id = new.id and field_definition_id::text = cfg->>'student_field_id';
  -- Turma: rótulo da opção (propriedade de opções) ou o texto.
  select coalesce((select o->>'label' from jsonb_array_elements(coalesce(fd.config->'options', '[]'::jsonb)) o
                    where o->>'id' = fv.value_text limit 1), fv.value_text)
    into v_turma
    from field_value fv join field_definition fd on fd.id = fv.field_definition_id
   where fv.card_id = new.id and fv.field_definition_id::text = cfg->>'class_field_id';
  v_name := coalesce(nullif(trim(v_name), ''), new.title);
  v_phone := public.survey_phone(v_phone);

  -- Sem telefone no card: o do cadastro de responsáveis, se o nome bater.
  if v_phone = '' and coalesce(v_aluno, '') <> '' then
    select public.survey_phone(g.phone) into v_phone
      from student_guardian g
     where g.organization_id = new.organization_id
       and public.sala_plain(g.student_name) = public.sala_plain(v_aluno)
       and public.sala_plain(g.name) = public.sala_plain(v_name)
       and g.phone <> ''
     limit 1;
    v_phone := coalesce(v_phone, '');
  end if;

  insert into meeting_survey (organization_id, card_id, participant, phone)
  values (new.organization_id, new.id, left(v_name, 200), v_phone);

  for v_uid in select jsonb_array_elements_text(coalesce(cfg->'confirmer_ids', '[]'::jsonb)) loop
    select split_part(coalesce(nullif(a.name, ''), 'equipe'), ' ', 1) into v_first from app_user a where a.id = v_uid::uuid;
    perform public.whatsapp_enqueue(v_uid::uuid, new.id, 'pesquisa_confirmar', format(
      E'Olá, %s! Estou passando para confirmar o contato para envio da pesquisa de satisfação do responsável pelo aluno %s%s.\nConfirma que este é o telefone certo?\n\nResponsável: %s\nTelefone: %s\n\n1 - Sim\n2 - Não (mande o número certo)\n\n(Pesquisa da reunião #%s, %s)',
      coalesce(v_first, 'equipe'),
      coalesce(nullif(trim(v_aluno), ''), new.title),
      case when coalesce(v_turma, '') <> '' then ' (' || v_turma || ')' else '' end,
      v_name,
      case when v_phone = '' then '(sem telefone no cadastro)' else v_phone end,
      new.number, b.name));
  end loop;
  return new;
end$$;

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
  v_words text[];
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

  -- Responsáveis do aluno (importados do ActiveSoft), para preencher o card da reunião.
  if p_tool = 'buscar_responsaveis' then
    v_words := array(select w from unnest(regexp_split_to_array(public.sala_plain(args->>'aluno'), '\s+')) w where length(w) > 1);
    if coalesce(array_length(v_words, 1), 0) = 0 then
      return jsonb_build_object('erro', 'Diga o nome do aluno.');
    end if;
    select coalesce(jsonb_agg(x.j order by x.score desc, x.nome), '[]'::jsonb) into v_list from (
      select g.student_name as nome,
             (select count(*) from unnest(v_words) w where public.sala_plain(g.student_name) like '%' || w || '%')
               + case when coalesce(args->>'turma', '') <> ''
                       and public.sala_room_key(g.room) = public.sala_room_key(args->>'turma') then 1 else 0 end as score,
             jsonb_build_object('aluno', g.student_name, 'turma', g.room,
               'responsaveis', jsonb_agg(jsonb_build_object(
                 'responsavel', g.slot, 'nome', g.name, 'parentesco', nullif(g.relation, ''),
                 'telefone', nullif(g.phone, '')) order by g.slot)) as j
        from student_guardian g
       where g.organization_id = (select organization_id from app_user where id = p_user)
       group by g.student_key, g.student_name, g.room
      having (select count(*) from unnest(v_words) w where public.sala_plain(g.student_name) like '%' || w || '%')
             >= greatest(1, ceil(array_length(v_words, 1) * 0.6))
       order by 2 desc limit 5) x;
    if jsonb_array_length(v_list) = 0 and not exists (select 1 from student_guardian) then
      return jsonb_build_object('erro', 'O cadastro de responsáveis ainda não foi importado do ActiveSoft. Peça o nome e o telefone à pessoa.');
    end if;
    return jsonb_build_object('alunos', v_list);
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

do $$
declare f text;
begin
  foreach f in array array[
    'public.meeting_survey_on_stage()',
    'public.whatsapp_survey(uuid, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
