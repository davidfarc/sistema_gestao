-- Papéis editáveis, Gestor Master e permissão própria da Gestão de Vila.
--
-- ATENÇÃO: confira o e-mail no bloco 3 antes de rodar. É a conta que vira
-- Gestor Master, a única capaz de editar papéis e de conceder papéis
-- administrativos. Se for outra conta, troque lá.

-- ---------------------------------------------------------------------------
-- 1. Chave estável dos papéis de sistema
-- ---------------------------------------------------------------------------
-- O código hoje acha papel por NOME ("Membro interno", "Externo"), o que
-- quebraria assim que a gestão pudesse renomeá-los na tela.

alter table role add column if not exists slug text;

-- O ilike evita depender do acento de "Gestor de área" na comparação.
update role set slug = 'gestor'  where slug is null and name = 'Gestor';
update role set slug = 'area'    where slug is null and name ilike 'Gestor de %';
update role set slug = 'interno' where slug is null and name = 'Membro interno';
update role set slug = 'externo' where slug is null and name = 'Externo';

create unique index if not exists role_org_slug_idx
  on role (organization_id, slug) where slug is not null;

comment on column role.slug is
  'Chave estavel dos papeis de sistema (master/gestor/area/interno/externo). '
  'Nulo em papeis criados pela gestao. Papel com slug nao pode ser excluido: '
  'o provisionamento de novos usuarios depende dele.';

-- ---------------------------------------------------------------------------
-- 2. Gestão de Vila vira permissão de verdade
-- ---------------------------------------------------------------------------
-- Até agora o módulo só perguntava "é interno?", então qualquer pessoa da
-- equipe editava. A intenção declarada é que Gestor de área NÃO edite a Vila;
-- quem coordena recebe um papel próprio, criado na tela.

update role
   set permissions = permissions || '["salas:manage"]'::jsonb
 where slug = 'gestor'
   and not (permissions ? 'salas:manage');

-- ---------------------------------------------------------------------------
-- 3. Gestor Master
-- ---------------------------------------------------------------------------
-- Separa "administrar o dia a dia" de "definir o que cada função pode fazer".
-- `role:manage` autoriza editar papéis e conceder papéis administrativos —
-- inclusive o de Gestor.

do $$
declare
  -- Conta que vira Gestor Master.
  master_email constant text := 'david@adm.eccoprime.com.br';

  org_id   uuid;
  master   uuid;
  usuario  uuid;
  todas    jsonb;
begin
  select id into org_id from organization order by created_at limit 1;
  if org_id is null then
    raise exception 'Nenhuma organizacao encontrada.';
  end if;

  todas := to_jsonb(array[
    'board:read','board:configure','card:read','card:create','card:update',
    'card:move','card:assign','comment:create','channel:read','channel:post',
    'channel:manage','field:manage','stage:manage','workflow:manage',
    'salas:manage','user:manage','role:manage'
  ]);

  select id into master from role where organization_id = org_id and slug = 'master';
  if master is null then
    insert into role (organization_id, name, permissions, slug)
    values (org_id, 'Gestor Master', todas, 'master')
    returning id into master;
  else
    update role set permissions = todas where id = master;
  end if;

  select id into usuario from app_user
   where organization_id = org_id and lower(email) = lower(master_email);

  if usuario is null then
    raise exception 'Usuario % nao encontrado - confira o e-mail no bloco 3.', master_email;
  end if;

  -- Um papel por usuário, como o resto do app assume.
  delete from user_role where user_id = usuario;
  insert into user_role (user_id, role_id) values (usuario, master);

  raise notice 'Gestor Master: %', master_email;
end $$;
