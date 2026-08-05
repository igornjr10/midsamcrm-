-- Segundo super admin do CRM.
--
-- Mesmo racional do 0021: concede por e-mail, não por id, porque o id só existe
-- depois do signup. Se a pessoa ainda não tiver se cadastrado, o update não
-- encontra a linha, não faz nada e não quebra o deploy — basta rodar de novo
-- (ou o SQL do docs/admin.md) depois do primeiro login dela.

update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.user_id
  and lower(u.email) = lower('samuel@midsam.com.br');
