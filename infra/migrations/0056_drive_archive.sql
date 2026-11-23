-- ============================================================================
-- 0056_drive_archive.sql — Evidências no Google Drive (SPEC-FASE2 §C)
--
-- Para pipelines com a opção ligada (`board.drive_archive`), cada card ganha
-- uma pasta no Drive com as fotos recebidas pelo WhatsApp e um TXT com a
-- descrição. Hierarquia: raiz → 1º campo obrigatório de opções (ex.: Série) →
-- 2º (ex.: Disciplina) → "Erro 001 - <demais campos obrigatórios>".
--
-- O sistema SÓ GRAVA no Drive, nunca lê: os ids das pastas e a numeração ficam
-- aqui no banco. Quem executa é o Worker `ecco-whatsapp`, a cada minuto:
--   whatsapp_drive_take   → o que falta gravar (pasta, TXT, fotos)
--   whatsapp_drive_folder → guarda o id de uma pasta de nível criada
--   whatsapp_drive_card   → guarda a pasta do card e põe o link nos anexos
--   whatsapp_drive_image  → marca a foto como gravada
--
-- Tabelas sem leitura pelo navegador; funções só com a chave de servidor.
-- Só aditiva. Idempotente.
-- ============================================================================

alter table board add column if not exists drive_archive boolean not null default false;
alter table whatsapp_media add column if not exists drive_uploaded_at timestamptz;

-- Pastas de nível já criadas (ex.: "3º ano", "3º ano/Ciências"), por pipeline.
create table if not exists drive_folder (
  board_id   uuid not null references board(id) on delete cascade,
  path       text not null,
  folder_id  text not null,
  created_at timestamptz not null default now(),
  primary key (board_id, path)
);

-- A pasta de cada card: número de ordem dentro do nível e id no Drive.
create table if not exists card_drive (
  card_id     uuid primary key references card(id) on delete cascade,
  board_id    uuid not null references board(id) on delete cascade,
  parent_path text not null,
  seq         integer not null,
  name        text not null,
  folder_id   text,
  attempts    integer not null default 0,
  taken_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists card_drive_parent_idx on card_drive (board_id, parent_path);

alter table drive_folder enable row level security;
alter table drive_folder force row level security;
alter table card_drive enable row level security;
alter table card_drive force row level security;
revoke all on drive_folder from anon, authenticated;
revoke all on card_drive from anon, authenticated;

-- Nome seguro para pasta/arquivo do Drive.
create or replace function public.drive_safe_name(p text)
returns text language sql immutable as $$
  select left(trim(regexp_replace(regexp_replace(coalesce(p, ''), '[/\\<>:"|?*\x00-\x1f]', ' ', 'g'), '\s+', ' ', 'g')), 120)
$$;

create or replace function public.whatsapp_drive_take(p_limit integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k record; f record; d record;
  v_levels text[]; v_rest text[]; v_val text; v_parent text; v_txt text;
  v_jobs jsonb := '[]'::jsonb; v_images jsonb; v_path text; v_folders jsonb; i integer;
begin
  for k in
    select c.id, c.number, c.title, c.description, c.board_id, c.organization_id, c.created_at, c.requester_id,
           b.name as board_name
      from card c join board b on b.id = c.board_id and b.drive_archive and b.archived_at is null
      left join card_drive cd on cd.card_id = c.id
     where c.archived_at is null
       and coalesce(cd.attempts, 0) < 5
       and (cd.taken_at is null or cd.taken_at < now() - interval '5 minutes')
       and (cd.folder_id is null
            or exists (select 1 from whatsapp_media wm where wm.card_id = c.id and wm.drive_uploaded_at is null))
       -- Só cards com evidência recebida pelo WhatsApp, ou abertos por ele.
       and (exists (select 1 from whatsapp_media wm where wm.card_id = c.id)
            or exists (select 1 from activity a where a.card_id = c.id and a.kind = 'card_created'
                        and a.payload->>'via' = 'whatsapp'))
     order by c.created_at
     limit least(greatest(p_limit, 1), 10)
  loop
    select * into d from card_drive where card_id = k.id;
    if d.card_id is null then
      -- Monta os níveis a partir dos campos obrigatórios da criação, na ordem.
      v_levels := '{}'; v_rest := '{}';
      for f in select fd.* from field_definition fd
                where fd.board_id = k.board_id and fd.archived_at is null and fd.show_on_create and fd.is_required
                  and fd.type in ('text', 'number', 'select', 'status') order by fd.position loop
        select coalesce(
                 (select o->>'label' from jsonb_array_elements(coalesce(f.config->'options', '[]'::jsonb)) o
                   where o->>'id' = fv.value_text limit 1),
                 fv.value_text, trim(trailing '.' from trim(trailing '0' from fv.value_number::text)))
          into v_val from field_value fv where fv.card_id = k.id and fv.field_definition_id = f.id;
        v_val := public.drive_safe_name(v_val);
        continue when v_val = '';
        if f.type in ('select', 'status') and coalesce(array_length(v_levels, 1), 0) < 2 then
          v_levels := array_append(v_levels, v_val);
        else
          v_rest := array_append(v_rest, case when f.name ~* '^p[áa]gina' then 'p. ' || v_val else v_val end);
        end if;
      end loop;
      if coalesce(array_length(v_levels, 1), 0) = 0 then v_levels := array['Sem classificação']; end if;
      v_parent := array_to_string(v_levels, '/');
      perform pg_advisory_xact_lock(hashtext(k.board_id::text || v_parent));
      select coalesce(max(seq), 0) + 1 into i from card_drive where board_id = k.board_id and parent_path = v_parent;
      insert into card_drive (card_id, board_id, parent_path, seq, name)
      values (k.id, k.board_id, v_parent, i,
              public.drive_safe_name('Erro ' || lpad(i::text, 3, '0')
                || case when coalesce(array_length(v_rest, 1), 0) > 0 then ' - ' || array_to_string(v_rest, ' - ') else '' end))
      returning * into d;
    end if;
    update card_drive set attempts = attempts + 1, taken_at = now() where card_id = k.id;

    -- Pastas de nível, da raiz para baixo, com o id já conhecido (ou null).
    v_folders := '[]'::jsonb; v_path := '';
    foreach v_val in array string_to_array(d.parent_path, '/') loop
      v_path := case when v_path = '' then v_val else v_path || '/' || v_val end;
      v_folders := v_folders || jsonb_build_object('path', v_path, 'name', v_val,
        'folder_id', (select folder_id from drive_folder where board_id = k.board_id and path = v_path));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object('id', wm.id, 'url', wm.url) order by wm.created_at), '[]'::jsonb)
      into v_images from whatsapp_media wm where wm.card_id = k.id and wm.drive_uploaded_at is null;

    -- O TXT só vai na criação da pasta.
    v_txt := null;
    if d.folder_id is null then
      v_txt := format(E'%s\r\nPedido #%s - %s\r\n\r\n', d.name, k.number, k.board_name)
        || coalesce((select string_agg(format('%s: %s', fd.name, coalesce(
                 (select o->>'label' from jsonb_array_elements(coalesce(fd.config->'options', '[]'::jsonb)) o
                   where o->>'id' = fv.value_text limit 1),
                 fv.value_text, fv.value_number::text)), E'\r\n' order by fd.position)
               from field_value fv join field_definition fd on fd.id = fv.field_definition_id
              where fv.card_id = k.id and fd.type in ('text', 'number', 'select', 'status')), '')
        || format(E'\r\n\r\nTítulo: %s\r\n\r\nDescrição:\r\n%s\r\n\r\nRegistrado por: %s\r\nData: %s\r\n',
             k.title,
             trim(replace(replace(replace(regexp_replace(regexp_replace(coalesce(k.description, ''),
                  '<br\s*/?>|</p>', E'\r\n', 'gi'), '<[^>]+>', '', 'g'), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')),
             coalesce((select coalesce(nullif(a.name, ''), a.email) from app_user a where a.id = k.requester_id), '?'),
             to_char(k.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
    end if;

    v_jobs := v_jobs || jsonb_build_object('card_id', k.id, 'board_id', k.board_id, 'levels', v_folders,
      'name', d.name, 'folder_id', d.folder_id, 'txt', v_txt, 'images', v_images);
  end loop;
  return v_jobs;
end$$;

create or replace function public.whatsapp_drive_folder(p_board uuid, p_path text, p_folder_id text)
returns void language sql security definer set search_path = public as $$
  insert into drive_folder (board_id, path, folder_id) values (p_board, p_path, p_folder_id)
  on conflict (board_id, path) do nothing
$$;

create or replace function public.whatsapp_drive_card(p_card uuid, p_folder_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_was text;
begin
  select folder_id into v_was from card_drive where card_id = p_card;
  update card_drive set folder_id = p_folder_id, attempts = 0, taken_at = null where card_id = p_card;
  if v_was is null and p_folder_id ~ '^[A-Za-z0-9_-]{10,}$' then
    select organization_id into v_org from card where id = p_card;
    insert into attachment (organization_id, card_id, kind, url, label)
    values (v_org, p_card, 'link', 'https://drive.google.com/drive/folders/' || p_folder_id, 'Pasta de evidências no Drive');
  end if;
end$$;

create or replace function public.whatsapp_drive_image(p_media uuid)
returns void language sql security definer set search_path = public as $$
  update whatsapp_media set drive_uploaded_at = now() where id = p_media;
  update card_drive set attempts = 0, taken_at = null
   where card_id = (select card_id from whatsapp_media where id = p_media)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.whatsapp_drive_take(integer)',
    'public.whatsapp_drive_folder(uuid, text, text)',
    'public.whatsapp_drive_card(uuid, text)',
    'public.whatsapp_drive_image(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end$$;
