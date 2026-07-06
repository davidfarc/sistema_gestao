-- Promove o primeiro usuário (owner) a Gestor.
delete from user_role
where user_id = (select id from app_user order by created_at limit 1);

insert into user_role (user_id, role_id)
select u.id, r.id
from (select id from app_user order by created_at limit 1) u,
     (select id from role where name = 'Gestor' limit 1) r;
