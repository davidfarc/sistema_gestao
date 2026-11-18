-- ============================================================================
-- 0049_whatsapp_base.sql — Atendimento pelo WhatsApp, base (SPEC-FASE2 §C, C1)
--
-- 1. `whatsapp_message`: registro curto das mensagens que entram e saem. Serve
--    para não processar a mesma mensagem duas vezes, frear enxurradas e, depois,
--    dar contexto ao agente. Guardado por 90 dias. De número NÃO cadastrado
--    não se guarda o texto, só que houve contato.
-- 2. `whatsapp_inbound`: chamada pelo Worker `ecco-whatsapp` a cada mensagem;
--    reconhece a pessoa pelo telefone cadastrado (`user_phone`, 0044).
-- 3. `whatsapp_outbound`: registra o que foi respondido (e se o envio falhou).
--
-- Ninguém lê a tabela pelo navegador (sem política de leitura); as funções só
-- aceitam a chave de servidor. Só cria; idempotente.
-- ============================================================================

create table if not exists whatsapp_message (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organization(id),
  user_id         uuid references app_user(id) on delete set null,
  phone           text not null,
  direction       text not null check (direction in ('in', 'out')),
  kind            text not null default 'text' check (kind in ('text', 'audio', 'other')),
  body            text not null default '',
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now()
);

create unique index if not exists whatsapp_message_provider_idx
  on whatsapp_message (provider_id) where provider_id is not null;
create index if not exists whatsapp_message_phone_idx on whatsapp_message (phone, created_at desc);
create index if not exists whatsapp_message_created_idx on whatsapp_message (created_at);

alter table whatsapp_message enable row level security;
alter table whatsapp_message force row level security;
revoke all on whatsapp_message from anon, authenticated;

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
          case when p_kind in ('text', 'audio', 'other') then p_kind else 'other' end,
          case when u.id is null then '' else left(coalesce(p_body, ''), 4000) end,
          p_provider_id)
  on conflict (provider_id) where provider_id is not null do nothing;
  get diagnostics v_new = row_count;

  select count(*) into v_recent from whatsapp_message
   where phone = p_phone and direction = 'in' and created_at > now() - interval '1 hour';
  select max(created_at) into v_last from whatsapp_message
   where phone = p_phone and direction = 'out' and error is null;

  -- Faxina: nada fica mais de 90 dias.
  delete from whatsapp_message where created_at < now() - interval '90 days';

  return jsonb_build_object(
    'duplicada', v_new = 0,
    'usuario', case when u.id is null then null
                    else jsonb_build_object('id', u.id, 'nome', coalesce(nullif(u.name, ''), u.email)) end,
    'recentes', v_recent,
    'minutos_desde_resposta', case when v_last is null then null
                                   else floor(extract(epoch from now() - v_last) / 60)::integer end);
end$$;

create or replace function public.whatsapp_outbound(
  p_phone text, p_user uuid, p_body text, p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into whatsapp_message (organization_id, user_id, phone, direction, body, error)
  select (select organization_id from app_user where id = p_user), p_user, p_phone, 'out',
         left(coalesce(p_body, ''), 4000), left(p_error, 200)
$$;

revoke all on function public.whatsapp_inbound(text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_outbound(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_inbound(text, text[], text, text, text) to service_role;
grant execute on function public.whatsapp_outbound(text, uuid, text, text) to service_role;
