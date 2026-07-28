-- Agenda — compromissos com hora marcada, no lugar do módulo de tarefas.
--
-- Diferença para tasks: o compromisso tem início obrigatório (a agenda é
-- desenhada sobre uma linha do tempo), fim opcional, marcação de dia inteiro e
-- um tipo, que a UI usa para diferenciar reunião/ligação/visita no calendário.
-- As tarefas existentes são convertidas e a tabela antiga é removida no fim.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  description text,
  location text,
  kind text not null default 'meeting'
    check (kind in ('meeting', 'call', 'visit', 'followup', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'done', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_period_ck check (ends_at is null or ends_at >= starts_at)
);

-- Consulta principal: os compromissos da empresa dentro de uma faixa de datas.
create index idx_appointments_company_start on public.appointments(company_id, starts_at);
create index idx_appointments_contact on public.appointments(contact_id) where contact_id is not null;

alter table public.appointments enable row level security;

create policy "company appointments" on public.appointments for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_appointments_updated_at
  before update on public.appointments
  for each row execute function public.update_updated_at_column();

-- ── Migração das tarefas existentes ─────────────────────────────────────────
-- O id é preservado para não quebrar nada que já aponte para a tarefa.
-- Tarefa sem due_at vira compromisso de dia inteiro no dia em que foi criada,
-- que é a única data conhecida sobre ela.
insert into public.appointments (
  id, user_id, company_id, contact_id, title, description,
  starts_at, all_day, status, created_at, updated_at
)
select
  t.id,
  t.user_id,
  t.company_id,
  t.contact_id,
  t.title,
  t.description,
  coalesce(t.due_at, date_trunc('day', t.created_at)),
  t.due_at is null,
  case when t.status = 'done' then 'done' else 'scheduled' end,
  t.created_at,
  t.updated_at
from public.tasks t;

drop table public.tasks;
