-- Acesso de super admin para o dono do CRM.
--
-- is_super_admin em profiles é a flag que a RLS consulta (public.is_super_admin):
-- quem a tem enxerga todas as empresas, acessa o painel de Empresas e pode
-- operar a conta de um cliente.
--
-- Concedida por e-mail e não por id porque o id só existe depois do signup —
-- e o e-mail é o que a pessoa sabe de cor. Se o e-mail não existir, a migration
-- não faz nada e não quebra o deploy.

update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.user_id
  and lower(u.email) = lower('igoruan099@gmail.com');
