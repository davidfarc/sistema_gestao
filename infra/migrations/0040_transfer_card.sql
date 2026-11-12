-- ============================================================================
-- 0040_transfer_card.sql — Enviar um card de um pipeline para outro
--
-- `transfer_card(card, pipeline de destino, quem enviou, mapa de campos)` faz
-- tudo numa transação só (ou tudo acontece, ou nada):
--
--   * o card passa a ser do pipeline de destino, na PRIMEIRA etapa dele (a
--     "entrada"), no fim da coluna, com um número novo da sequência do destino;
--   * o responsável é removido: quem define o novo dono é a gestão do destino.
--     O solicitante, os comentários, checklists, anexos e o histórico ficam;
--   * campos próprios do pipeline de origem: os que o mapa liga a um campo do
--     destino (de tipo compatível) são levados; os demais NÃO se perdem, viram
--     um comentário no card. Campos globais não mudam;
--   * a priorização do pipeline de origem é arquivada;
--   * o histórico ganha `card_transferred`, com origem, destino e os números.
--
-- Quem pode enviar e para onde é conferido pelo servidor antes de chamar; por
-- isso a função só é executável pela chave de serviço (ver 0038).
--
-- Só cria função. Idempotente.
-- ============================================================================

create or replace function public.transfer_card(
  p_card uuid, p_target_board uuid, p_actor uuid, p_map jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c          card%rowtype;
  src_name   text;
  tgt        board%rowtype;
  v_stage    uuid;
  v_number   bigint;
  v_pos      numeric;
  v_prev     uuid;
  r          record;
  v_to       uuid;
  tf         field_definition%rowtype;
  v_display  text;
  v_option   text;
  v_ok       boolean;
  v_left     text := '';
  v_moved    integer := 0;
begin
  select * into c from card where id = p_card for update;
  if not found then raise exception 'card_not_found'; end if;
  if c.board_id = p_target_board then raise exception 'same_board'; end if;

  select * into tgt from board
   where id = p_target_board and archived_at is null and organization_id = c.organization_id;
  if not found then raise exception 'target_not_found'; end if;
  select name into src_name from board where id = c.board_id;

  select id into v_stage from stage
   where board_id = tgt.id and archived_at is null
   order by position, name limit 1;
  if v_stage is null then raise exception 'target_without_stages'; end if;

  -- Dois envios simultâneos para o mesmo pipeline não podem pegar o mesmo número.
  perform pg_advisory_xact_lock(hashtext('card_number:' || tgt.id::text));
  select coalesce(max(number), 0) + 1 into v_number from card where board_id = tgt.id;
  select coalesce(max(position), 0) + 1000 into v_pos from card where stage_id = v_stage;

  select a.user_id into v_prev from assignment a
   where a.card_id = p_card and a.stage_id is null limit 1;

  -- Campos PRÓPRIOS do pipeline de origem (os globais, board_id nulo, ficam).
  for r in
    select v.*, f.name as fname, f.type as ftype, f.config as fconfig
      from field_value v
      join field_definition f on f.id = v.field_definition_id
     where v.card_id = p_card and f.board_id = c.board_id
     order by f.position
  loop
    v_display := case r.ftype
      when 'checkbox' then case when r.value_bool then 'sim' else null end
      when 'number'   then r.value_number::text
      when 'date'     then to_char(r.value_date, 'DD/MM/YYYY')
      when 'member'   then (select coalesce(nullif(u.name, ''), u.email) from app_user u where u.id = r.value_member_id)
      when 'select'   then coalesce((select o->>'label' from jsonb_array_elements(coalesce(r.fconfig->'options', '[]'::jsonb)) o
                                      where o->>'id' = r.value_text limit 1), r.value_text)
      when 'status'   then coalesce((select o->>'label' from jsonb_array_elements(coalesce(r.fconfig->'options', '[]'::jsonb)) o
                                      where o->>'id' = r.value_text limit 1), r.value_text)
      else r.value_text
    end;

    v_ok := false;
    if v_display is not null and v_display <> '' then
      select nullif(m->>'to', '')::uuid into v_to
        from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) m
       where m->>'from' = r.field_definition_id::text
       limit 1;

      if v_to is not null then
        select * into tf from field_definition
         where id = v_to and board_id = tgt.id and archived_at is null;
        if found and (
             tf.type = r.ftype
          or (tf.type in ('text', 'long_text') and r.ftype in ('text', 'long_text'))
          or (tf.type in ('select', 'status') and r.ftype in ('select', 'status'))
        ) then
          if tf.type in ('select', 'status') then
            -- A opção é reconhecida pelo NOME (os ids são de cada campo).
            select o->>'id' into v_option
              from jsonb_array_elements(coalesce(tf.config->'options', '[]'::jsonb)) o
             where lower(trim(o->>'label')) = lower(trim(v_display)) limit 1;
            if v_option is not null then
              insert into field_value (field_definition_id, card_id, organization_id, value_text)
              values (tf.id, p_card, c.organization_id, v_option)
              on conflict (field_definition_id, card_id) do update set value_text = excluded.value_text;
              v_ok := true;
            end if;
          else
            insert into field_value (field_definition_id, card_id, organization_id,
                                     value_text, value_number, value_date, value_bool, value_member_id, value_json)
            values (tf.id, p_card, c.organization_id,
                    r.value_text, r.value_number, r.value_date, r.value_bool, r.value_member_id, r.value_json)
            on conflict (field_definition_id, card_id) do update set
              value_text = excluded.value_text, value_number = excluded.value_number,
              value_date = excluded.value_date, value_bool = excluded.value_bool,
              value_member_id = excluded.value_member_id, value_json = excluded.value_json;
            v_ok := true;
          end if;
        end if;
      end if;

      if v_ok then v_moved := v_moved + 1;
      else v_left := v_left || '• ' || r.fname || ': ' || left(v_display, 500) || E'\n';
      end if;
    end if;

    delete from field_value
     where field_definition_id = r.field_definition_id and card_id = p_card;
  end loop;

  delete from assignment where card_id = p_card;
  update prioritization set archived_at = now() where card_id = p_card and archived_at is null;

  update card
     set board_id = tgt.id, stage_id = v_stage, stage_entered_at = now(),
         number = v_number, position = v_pos
   where id = p_card;

  insert into activity (organization_id, card_id, actor_id, kind, payload)
  values (c.organization_id, p_card, p_actor, 'card_transferred', jsonb_build_object(
    'fromBoardId', c.board_id, 'fromBoardName', src_name,
    'toBoardId', tgt.id, 'toBoardName', tgt.name,
    'fromStageId', c.stage_id, 'toStageId', v_stage,
    'oldNumber', c.number, 'newNumber', v_number,
    'fieldsMoved', v_moved, 'previousResponsibleId', v_prev));

  if v_left <> '' then
    insert into comment (organization_id, card_id, author_id, body)
    values (c.organization_id, p_card, p_actor,
      format(E'Veio do pipeline “%s” (era #%s). Campos de lá que não têm correspondente aqui:\n%s',
             src_name, c.number, rtrim(v_left, E'\n')));
  end if;

  return jsonb_build_object('boardId', tgt.id, 'boardName', tgt.name, 'stageId', v_stage,
                            'number', v_number, 'fieldsMoved', v_moved, 'fieldsKept', v_left <> '');
end$$;

revoke all on function public.transfer_card(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.transfer_card(uuid, uuid, uuid, jsonb) to service_role;
