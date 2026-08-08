-- Conta de super admin oculta dos outros super admins (break-glass do dono).
--
-- A página Empresas e company_owners() já não mostram quem não é membro de
-- nenhuma empresa — então uma conta sem vínculo já some da interface. Falta a
-- fresta da API: a policy "super admin reads profiles" deixa qualquer super
-- admin ler TODOS os perfis pelo PostgREST, mesmo fora da UI. hidden_admin
-- fecha isso.
--
-- Limite honesto: isto esconde de quem usa o app (UI + chave anon). NÃO esconde
-- de quem tem acesso ao painel do Supabase / service role — lá auth.users
-- lista todo mundo e a service role ignora RLS. Não existe como esconder disso
-- sem degradar o próprio banco, e não é o que esta migration tenta fazer.

alter table public.profiles
  add column if not exists hidden_admin boolean not null default false;

comment on column public.profiles.hidden_admin is
  'Conta de dono oculta: some das leituras de perfil que os outros super admins fazem. Não esconde de quem tem acesso ao banco.';

-- Cada um continua lendo o próprio perfil pela policy "own profile"; um super
-- admin oculto enxerga a si mesmo por ela. O que muda é que um super admin
-- deixa de ver os perfis marcados como ocultos.
drop policy if exists "super admin reads profiles" on public.profiles;
create policy "super admin reads profiles" on public.profiles for select
  using (public.is_super_admin() and not coalesce(hidden_admin, false));
