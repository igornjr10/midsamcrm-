-- Multi-empresa: cada conta de negocio vira uma "company" com membros.
-- Dados passam a ser escopados por company_id; profiles.is_super_admin permite
-- ao dono do produto enxergar/administrar todas as empresas.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at_column();

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

alter table public.profiles add column is_super_admin boolean not null default false;

-- Helpers SECURITY DEFINER: evitam recursao de RLS (consultam company_members
-- por fora das policies).
create or replace function public.my_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.company_members where user_id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_super_admin from public.profiles where user_id = auth.uid()),
    false
  );
$$;

alter table public.companies enable row level security;
create policy "member or super admin reads company" on public.companies for select
  using (id in (select public.my_company_ids()) or public.is_super_admin());
create policy "super admin manages companies" on public.companies for all
  using (public.is_super_admin()) with check (public.is_super_admin());

alter table public.company_members enable row level security;
create policy "member or super admin reads members" on public.company_members for select
  using (company_id in (select public.my_company_ids()) or public.is_super_admin());
create policy "super admin manages members" on public.company_members for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ── company_id nas tabelas de dados ─────────────────────────────────────────
alter table public.contacts add column company_id uuid references public.companies(id) on delete cascade;
alter table public.conversations add column company_id uuid references public.companies(id) on delete cascade;
alter table public.tasks add column company_id uuid references public.companies(id) on delete cascade;
alter table public.whatsapp_configs add column company_id uuid references public.companies(id) on delete cascade;

-- Backfill: cria uma empresa para cada usuario existente e vincula os dados.
do $$
declare
  rec record;
  v_company uuid;
begin
  for rec in select p.user_id, coalesce(p.business_name, p.full_name, 'Minha empresa') as cname from public.profiles p loop
    insert into public.companies (name) values (rec.cname) returning id into v_company;
    insert into public.company_members (company_id, user_id, role) values (v_company, rec.user_id, 'admin');
    update public.contacts set company_id = v_company where user_id = rec.user_id;
    update public.conversations set company_id = v_company where user_id = rec.user_id;
    update public.tasks set company_id = v_company where user_id = rec.user_id;
    update public.whatsapp_configs set company_id = v_company where user_id = rec.user_id;
  end loop;
end;
$$;

alter table public.contacts alter column company_id set not null;
alter table public.conversations alter column company_id set not null;
alter table public.tasks alter column company_id set not null;
alter table public.whatsapp_configs alter column company_id set not null;

create index idx_contacts_company on public.contacts(company_id);
create index idx_conversations_company on public.conversations(company_id);
create index idx_tasks_company on public.tasks(company_id);

-- Config WhatsApp passa a ser 1 por empresa (nao mais 1 por usuario).
alter table public.whatsapp_configs drop constraint whatsapp_configs_user_id_key;
create unique index whatsapp_configs_company_uniq on public.whatsapp_configs(company_id);

-- ── RLS reescrita: escopo por empresa ───────────────────────────────────────
drop policy "own contacts" on public.contacts;
create policy "company contacts" on public.contacts for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

drop policy "own conversations" on public.conversations;
create policy "company conversations" on public.conversations for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

drop policy "own tasks" on public.tasks;
create policy "company tasks" on public.tasks for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

drop policy "own whatsapp config" on public.whatsapp_configs;
create policy "company whatsapp config" on public.whatsapp_configs for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- Super admin tambem enxerga todos os profiles (gestao de usuarios).
create policy "super admin reads profiles" on public.profiles for select
  using (public.is_super_admin());

-- ── Signup: cria empresa automaticamente (a menos que criado via painel) ────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  insert into public.profiles (user_id, full_name, business_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'business_name'
  );

  -- Usuarios criados pelo painel de Empresas (super admin) ja recebem membership
  -- na empresa alvo; a flag pula a criacao da empresa automatica.
  if coalesce(new.raw_user_meta_data ->> 'skip_auto_company', '') <> 'true' then
    insert into public.companies (name)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'business_name', ''), 'Minha empresa'))
    returning id into v_company;
    insert into public.company_members (company_id, user_id, role)
    values (v_company, new.id, 'admin');
  end if;

  return new;
end;
$$;

-- ── find_contact_by_phone agora por empresa ─────────────────────────────────
drop function public.find_contact_by_phone(uuid, text);
create or replace function public.find_contact_by_phone(p_company_id uuid, p_phone text)
returns setof public.contacts
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select public.normalize_phone(p_phone) as digits
  )
  select c.*
  from public.contacts c, target t
  where c.company_id = p_company_id
    and c.normalized_phone is not null
    and t.digits is not null
    and (
      c.normalized_phone = t.digits
      or c.normalized_phone = '55' || t.digits
      or '55' || c.normalized_phone = t.digits
      or right(c.normalized_phone, 8) = right(t.digits, 8)
    )
  limit 1;
$$;

grant execute on function public.find_contact_by_phone(uuid, text) to authenticated, service_role;
grant execute on function public.my_company_ids() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
