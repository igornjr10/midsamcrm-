-- Inverte quem manda na plataforma: a Midsam passa a ser o super admin, a
-- Realize vira cliente comum.
--
-- Estava ao contrário. Super admin é o dono do CRM — enxerga todas as empresas,
-- abre o painel de Empresas e opera a conta de um cliente. Quem é cliente não
-- pode ter isso; a Realize é uma empresa atendida como outra qualquer, e o
-- admin dela precisa parar no próprio funil.
--
-- A ordem aqui é deliberada: concede primeiro, confere, só então revoga. O
-- inverso arrisca o único cenário sem volta pela interface — ninguém com super
-- admin, e a tela de Empresas inacessível para consertar.

do $$
declare
  v_midsam int;
begin
  -- ── 1. Midsam ganha ───────────────────────────────────────────────────────
  -- Por empresa OU por domínio do e-mail: quem foi promovido pela 0027 pode
  -- ainda não estar ligado à empresa Midsam, e continua sendo da casa.
  update public.profiles p
  set is_super_admin = true
  where exists (
    select 1
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.user_id = p.user_id and c.name ilike '%midsam%'
  )
  or exists (
    select 1 from auth.users u
    where u.id = p.user_id and lower(u.email) like '%@midsam.com.br'
  );

  -- ── 2. Confere antes de tirar de alguém ───────────────────────────────────
  select count(*) into v_midsam
  from public.profiles p
  where p.is_super_admin
    and (
      exists (
        select 1
        from public.company_members m
        join public.companies c on c.id = m.company_id
        where m.user_id = p.user_id and c.name ilike '%midsam%'
      )
      or exists (
        select 1 from auth.users u
        where u.id = p.user_id and lower(u.email) like '%@midsam.com.br'
      )
    );

  if v_midsam = 0 then
    raise exception
      'Nenhum usuario da Midsam encontrado (nem empresa com "midsam" no nome, nem e-mail @midsam.com.br). Inversao abortada para nao deixar a plataforma sem super admin.';
  end if;

  -- ── 3. Todo o resto perde ─────────────────────────────────────────────────
  -- Quem não é da Midsam não é dono do CRM, seja da Realize ou de qualquer
  -- outra empresa que entre depois.
  update public.profiles p
  set is_super_admin = false
  where p.is_super_admin
    and not exists (
      select 1
      from public.company_members m
      join public.companies c on c.id = m.company_id
      where m.user_id = p.user_id and c.name ilike '%midsam%'
    )
    and not exists (
      select 1 from auth.users u
      where u.id = p.user_id and lower(u.email) like '%@midsam.com.br'
    );

  raise notice 'Super admin agora: % usuario(s) da Midsam.', v_midsam;
end $$;
