-- Agenda com recursos, lista de espera e confirmação.
--
-- Para a clínica, a agenda é o produto. Três coisas que faltavam:
--
--   recursos     -> quem ou o que atende: a profissional, a sala, a cadeira.
--                   O compromisso aponta para um; a agenda filtra por ele.
--   lista de     -> quem quer um horário que não existe ainda. Quando um
--   espera          compromisso é cancelado, a equipe oferece a vaga.
--   confirmação  -> lembrete no dia anterior com "1 confirmar / 2 remarcar".
--                   A resposta marca o compromisso; "2" chama uma pessoa.

-- ── Recursos ────────────────────────────────────────────────────────────────
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null default 'profissional'
    check (kind in ('profissional', 'sala', 'equipamento', 'outro')),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.resources enable row level security;
create policy "company resources" on public.resources for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

alter table public.appointments
  add column if not exists resource_id uuid references public.resources(id) on delete set null,
  /** Quando o lembrete do dia anterior saiu. Null = ainda não. */
  add column if not exists reminder_sent_at timestamptz,
  /** Quando o cliente respondeu "1". */
  add column if not exists confirmed_at timestamptz,
  /** A resposta crua ao lembrete: '1', '2'. */
  add column if not exists confirmation_reply text;

create index if not exists idx_appointments_resource on public.appointments(resource_id)
  where resource_id is not null;

-- ── Lista de espera ─────────────────────────────────────────────────────────
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete set null,
  notes text,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'atendido', 'cancelado')),
  created_at timestamptz not null default now()
);

create index idx_waitlist_company on public.waitlist(company_id, status, created_at);

alter table public.waitlist enable row level security;
create policy "company waitlist" on public.waitlist for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Lembrete e confirmação ──────────────────────────────────────────────────
-- Mais um tipo de régua, uma por empresa: a mensagem do lembrete. Não passa
-- por relationship_rule_targets porque o alvo é o compromisso, não o contato.
alter table public.relationship_rules
  drop constraint if exists relationship_rules_kind_check;
alter table public.relationship_rules
  add constraint relationship_rules_kind_check
  check (kind in ('aniversario', 'reativacao', 'nps', 'data', 'agenda'));

/**
 * Compromissos de amanhã (no fuso da empresa) que ainda não receberam o
 * lembrete. Só a chave de serviço chama.
 */
create or replace function public.appointment_reminder_targets(p_company_id uuid)
returns table (
  appointment_id uuid,
  contact_id uuid,
  name text,
  phone text,
  title text,
  starts_at timestamptz,
  all_day boolean,
  resource_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_tomorrow date;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
     ) <> 'service_role' then
    return;
  end if;

  select coalesce(followup_timezone, 'America/Sao_Paulo') into v_tz
  from public.ai_configs where company_id = p_company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_tomorrow := (now() at time zone v_tz)::date + 1;

  return query
  select a.id, c.id, c.name, c.phone, a.title, a.starts_at, a.all_day, r.name
  from public.appointments a
  join public.contacts c on c.id = a.contact_id
  left join public.resources r on r.id = a.resource_id
  where a.company_id = p_company_id
    and a.status = 'scheduled'
    and a.reminder_sent_at is null
    and (a.starts_at at time zone v_tz)::date = v_tomorrow
    and c.phone is not null
    and length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
  order by a.starts_at;
end;
$$;

notify pgrst, 'reload schema';
