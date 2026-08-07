-- E-mail de login de cada empresa, para o painel de Empresas.
--
-- O e-mail mora em auth.users, que o cliente não lê nem com RLS aberta. Esta
-- function é SECURITY DEFINER e só devolve linhas para quem é super admin —
-- sem isso, qualquer usuário autenticado listaria os e-mails da plataforma.
--
-- "Dono" da empresa = a membership 'admin' mais antiga (a que o painel cria
-- junto com a empresa). Se nenhuma for 'admin', cai na mais antiga qualquer.

create or replace function public.company_owners()
returns table (company_id uuid, user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.company_id)
    m.company_id,
    m.user_id,
    u.email::text
  from public.company_members m
  join auth.users u on u.id = m.user_id
  where public.is_super_admin()
  order by m.company_id, (m.role = 'admin') desc, m.created_at asc;
$$;

grant execute on function public.company_owners() to authenticated;
