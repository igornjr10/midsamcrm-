-- Contatos (leads) — cada usuario ve apenas os proprios.

-- Normalizacao BR: remove nao-digitos; util para casar telefone do WhatsApp
-- (ex: 5599984507515) com o formato digitado (ex: (99) 98450-7515).
create or replace function public.normalize_phone(raw text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '');
$$;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  normalized_phone text,
  email text,
  stage text not null default 'new',
  loss_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_user_stage on public.contacts(user_id, stage);
create index idx_contacts_user_normalized_phone
  on public.contacts(user_id, normalized_phone)
  where normalized_phone is not null;

alter table public.contacts enable row level security;

create policy "own contacts" on public.contacts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.trg_set_contact_normalized_phone()
returns trigger
language plpgsql
as $$
begin
  new.normalized_phone = public.normalize_phone(new.phone);
  return new;
end;
$$;

create trigger set_contact_normalized_phone
  before insert or update of phone on public.contacts
  for each row execute function public.trg_set_contact_normalized_phone();

create trigger update_contacts_updated_at
  before update on public.contacts
  for each row execute function public.update_updated_at_column();

-- Busca contato por variantes do telefone (com/sem 55, com/sem 9 extra).
-- Usada pelo webhook (service role) e pela UI para evitar duplicatas.
create or replace function public.find_contact_by_phone(p_user_id uuid, p_phone text)
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
  where c.user_id = p_user_id
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
