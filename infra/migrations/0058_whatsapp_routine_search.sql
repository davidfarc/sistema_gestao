-- ============================================================================
-- 0058_whatsapp_routine_search.sql — Busca de aluno mais tolerante (Luix)
--
-- Caso real (25/11): "João Arco Verde" do "Kids 3 B" não achava "João Elihimas
-- Arcoverde" do "K3B". Agora a busca:
--  - ignora espaços e acentos ("Arco Verde" = "Arcoverde");
--  - aceita sobrenome mal transcrito do áudio (basta a maioria das palavras);
--  - entende as siglas das turmas ("Kids 3 B" = "K3B", "Little Kids 2 A" =
--    "LK2A", "Junior 4" = "J4");
--  - usa a turma para ORDENAR, não para excluir, e diz se a turma confere.
--
-- Só troca funções. Idempotente.
-- ============================================================================

-- Chave comparável do nome da turma: sem acento, sem espaço, com as siglas.
create or replace function public.sala_room_key(p text)
returns text language sql immutable as $$
  select replace(replace(replace(
           regexp_replace(public.sala_plain(p), '[^a-z0-9]', '', 'g'),
           'littlekids', 'lk'), 'kids', 'k'), 'junior', 'j')
$$;

create or replace function public.whatsapp_routine(p_user uuid, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  args    jsonb := coalesce(p_args, '{}'::jsonb);
  u       record;
  v_state jsonb;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_date  date;
  v_id    text;
  st      jsonb;
  v_room  jsonb;
  v_path  text;
  v_field text;
  v_list  jsonb;
  v_note  text;
  v_done  text[] := '{}';
  v_words text[];
begin
  select id, organization_id, name, email into u
    from app_user where id = p_user and archived_at is null and is_internal;
  if u.id is null then return jsonb_build_object('erro', 'Pessoa não encontrada.'); end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u.id::text, 'role', 'authenticated')::text, true);

  if p_tool = 'rotina_contexto' then
    return jsonb_build_object('pode_rotina', public.has_access('salas'), 'hoje_iso', to_char(v_today, 'YYYY-MM-DD'));
  end if;

  if not public.has_access('salas') then
    return jsonb_build_object('erro', 'Você não tem acesso à Gestão de Vila. Ajustes de rotina só para quem tem esse acesso.');
  end if;

  select state into v_state from sala_state where organization_id = u.organization_id;
  if v_state is null then return jsonb_build_object('erro', 'A Gestão de Vila ainda não tem dados.'); end if;

  -- ── buscar_aluno ───────────────────────────────────────────────────────────
  -- Tolerante a como as pessoas falam e a erros de transcrição de áudio:
  -- "Arco Verde" acha "Arcoverde", "Kids 3 B" acha "K3B", e um sobrenome
  -- mal ouvido ("Limas" por "Elihimas") não impede achar pelos outros nomes.
  -- Devolve os mais parecidos primeiro; a turma ordena, não exclui.
  if p_tool = 'buscar_aluno' then
    v_words := array_remove(regexp_split_to_array(public.sala_plain(trim(args->>'nome')), '[^a-z0-9]+'), '');
    if coalesce(array_length(v_words, 1), 0) = 0 then
      return jsonb_build_object('erro', 'Informe o nome do aluno.');
    end if;
    return (
      with s as (
        select x as st from public.sala_items(v_state->'students') x
         where coalesce((x->>'left')::boolean, false) is not true
      ), r as (
        select x as rm from public.sala_items(v_state->'rooms') x
      ), c as (
        select s.st, r.rm,
               public.sala_plain(s.st->>'name') as nm,
               regexp_replace(public.sala_plain(s.st->>'name'), '[^a-z0-9]', '', 'g') as nm_flat
          from s left join r on trim(r.rm->>'id') = trim(s.st->>'roomId')
      ), scored as (
        select c.*,
               -- palavras do pedido que aparecem no nome (com ou sem espaços)
               (select count(*) from unnest(v_words) w
                 where length(w) >= 2 and (c.nm like '%' || w || '%' or c.nm_flat like '%' || w || '%')) as hits,
               -- o pedido inteiro, sem espaços, dentro do nome sem espaços ("arcoverde")
               (c.nm_flat like '%' || array_to_string(v_words, '') || '%') as joined,
               -- o primeiro nome bate?
               (split_part(c.nm, ' ', 1) = v_words[1]) as first_ok,
               (nullif(trim(args->>'turma'), '') is not null
                and public.sala_room_key(c.rm->>'name') <> ''
                and (public.sala_room_key(c.rm->>'name') = public.sala_room_key(args->>'turma')
                     or public.sala_room_key(c.rm->>'name') like public.sala_room_key(args->>'turma') || '%')) as room_ok
          from c
      ), m as (
        select * from scored
         where joined or hits >= greatest(1, least(2, coalesce(array_length(v_words, 1), 0)))
            or (hits >= 1 and room_ok)
      )
      select jsonb_build_object(
        'total', (select count(*) from m),
        'alunos', coalesce((select jsonb_agg(jsonb_build_object(
                    'aluno_id', trim(m.st->>'id'),
                    'nome_completo', m.st->>'name',
                    'turma', coalesce(m.rm->>'name', 'sem turma'),
                    'vila', case when m.rm->>'segmento' = 'vila2' then 'Vila 2' else 'Vila 1' end,
                    'turma_confere', m.room_ok)
                    order by m.room_ok desc, m.joined desc, m.hits desc, m.first_ok desc, m.st->>'name')
                  from (select * from m order by m.room_ok desc, m.joined desc, m.hits desc, m.first_ok desc, m.st->>'name' limit 10) m), '[]'::jsonb),
        'aviso', case
                   when (select count(*) from m) = 0 then 'Nenhum aluno parecido. Tente só o primeiro nome ou só o sobrenome, ou peça a turma.'
                   when (select count(*) from m) > 10 then 'Muitos parecidos: estes são os 10 mais próximos; peça o nome completo ou a turma.'
                 end)
    );
  end if;

  -- ── registrar_rotina ───────────────────────────────────────────────────────
  if p_tool = 'registrar_rotina' then
    if coalesce((args->>'confirmado_pela_pessoa')::boolean, false) is not true then
      return jsonb_build_object('erro', 'Antes de gravar, confirme com a pessoa o nome completo do aluno, a data e o que marcar.');
    end if;
    begin
      v_date := (args->>'data')::date;
    exception when others then
      return jsonb_build_object('erro', 'Data inválida. Use AAAA-MM-DD.');
    end;
    if v_date < v_today then
      return jsonb_build_object('erro', 'Só dá para registrar hoje ou em data futura. Datas passadas são ajustadas pelo site.');
    end if;
    if v_date > v_today + 365 then
      return jsonb_build_object('erro', 'A data está a mais de um ano. Confira com a pessoa.');
    end if;
    if extract(isodow from v_date) > 5 then
      return jsonb_build_object('erro', 'Essa data cai num fim de semana. Confira com a pessoa.');
    end if;

    v_id := trim(args->>'aluno_id');
    select x into st from public.sala_items(v_state->'students') x where trim(x->>'id') = v_id limit 1;
    if st is null then return jsonb_build_object('erro', 'Aluno não encontrado. Use buscar_aluno.'); end if;
    if coalesce((st->>'left')::boolean, false) then
      return jsonb_build_object('erro', 'Esse aluno está fora da turma.');
    end if;
    v_note := nullif(trim(coalesce(args->>'observacao', '')), '');
    if not (coalesce((args->>'falta')::boolean, false) or coalesce((args->>'atraso')::boolean, false)
            or coalesce((args->>'mais_time')::boolean, false) or v_note is not null) then
      return jsonb_build_object('erro', 'Nada para registrar: informe falta, atraso, +time ou uma observação.');
    end if;

    -- Trava o documento enquanto grava (duas pessoas ao mesmo tempo não se apagam).
    perform 1 from sala_state where organization_id = u.organization_id for update;
    select state into v_state from sala_state where organization_id = u.organization_id;
    v_path := to_char(v_date, 'YYYY-MM-DD');

    foreach v_field in array array['absences', 'earlyDepartures', 'extraTime'] loop
      continue when not coalesce((args->>case v_field when 'absences' then 'falta'
                                                    when 'earlyDepartures' then 'atraso'
                                                    else 'mais_time' end)::boolean, false);
      v_list := coalesce(v_state #> array['dailyRoutine', v_path, v_field], '[]'::jsonb);
      if jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;
      if not exists (select 1 from jsonb_array_elements_text(v_list) e where trim(e) = v_id) then
        v_state := public.jsonb_set_deep(v_state, array['dailyRoutine', v_path, v_field], v_list || to_jsonb(v_id));
      end if;
      v_done := array_append(v_done, case v_field when 'absences' then 'falta' when 'earlyDepartures' then 'atraso' else '+time' end);
    end loop;

    if v_note is not null then
      v_note := left(v_note, 500) || ' (pelo WhatsApp, ' || coalesce(nullif(u.name, ''), u.email) || ')';
      v_state := public.jsonb_set_deep(v_state, array['dailyRoutine', v_path, 'studentNotes', v_id],
        to_jsonb(coalesce(nullif(v_state #>> array['dailyRoutine', v_path, 'studentNotes', v_id], '') || ' | ', '') || v_note));
      v_done := array_append(v_done, 'observação');
    end if;

    update sala_state set state = v_state, updated_at = now() where organization_id = u.organization_id;

    select x into v_room from public.sala_items(v_state->'rooms') x where trim(x->>'id') = trim(st->>'roomId') limit 1;
    return jsonb_build_object('ok', true, 'aluno', st->>'name', 'turma', coalesce(v_room->>'name', 'sem turma'),
      'data', to_char(v_date, 'DD/MM/YYYY'), 'registrado', to_jsonb(v_done),
      'futuro', v_date > v_today);
  end if;

  return jsonb_build_object('erro', 'Ferramenta desconhecida.');
end$$;

revoke all on function public.whatsapp_routine(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_routine(uuid, text, jsonb) to service_role;
