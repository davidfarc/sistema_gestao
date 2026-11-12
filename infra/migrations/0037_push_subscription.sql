-- ============================================================================
-- 0037_push_subscription.sql — Inscrições de notificação push (Web Push)
--
-- Uma linha por APARELHO/navegador em que a pessoa ativou as notificações.
-- `endpoint` é o endereço que o serviço de push (Google, Apple, Mozilla) deu a
-- esse navegador; `p256dh` e `auth` são as chaves dele para cifrar a mensagem.
--
-- RLS: cada pessoa lê só as próprias linhas. Não há política de escrita: quem
-- grava e apaga é o servidor (Server Action, com a chave de serviço), depois de
-- conferir a sessão.
--
-- Só cria tabela nova. Idempotente.
-- ============================================================================

create table if not exists push_subscription (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  user_id         uuid not null references app_user(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscription_user_idx on push_subscription (user_id);

alter table push_subscription enable row level security;

drop policy if exists push_subscription_read on push_subscription;
create policy push_subscription_read on push_subscription for select to authenticated
  using (user_id = auth.uid());

revoke all on push_subscription from anon;
revoke insert, update, delete on push_subscription from authenticated;
