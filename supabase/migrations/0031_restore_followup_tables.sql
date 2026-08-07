-- Reparo de drift: recria followup_steps e followup_logs.
--
-- O histórico de migrations diz que a 0010 rodou neste banco, mas as duas
-- tabelas que ela cria não existem mais — foram dropadas por fora, direto no
-- SQL Editor. Enquanto isso, `followup_candidates` e `save_followup_steps`
-- continuam lá: função `language sql` com corpo em $$ não guarda dependência
-- de tabela, então o drop não as levou junto — elas só quebram em runtime.
--
-- Efeito prático: o follow-up do SDR nunca funcionou neste projeto, e a 0032
-- (que recria followup_candidates lendo followup_logs) não conseguia aplicar.
--
-- Definições copiadas da 0010, que é a versão final — nenhuma migration
-- posterior mexeu nessas tabelas. Tudo idempotente: em qualquer banco onde a
-- 0010 pegou de verdade, esta migration é no-op.

-- ── Passos da cadência ──────────────────────────────────────────────────────
create table if not exists public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  step_order smallint not null,
  delay_hours numeric(6,2) not null default 24 check (delay_hours > 0),
  kind text not null default 'text' check (kind in ('text', 'ai', 'template')),
  message text,
  template_name text,
  template_language text not null default 'pt_BR',
  template_body text,
  variable_map jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, step_order)
);

create index if not exists idx_followup_steps_company
  on public.followup_steps(company_id, step_order);

drop trigger if exists update_followup_steps_updated_at on public.followup_steps;
create trigger update_followup_steps_updated_at
  before update on public.followup_steps
  for each row execute function public.update_updated_at_column();

alter table public.followup_steps enable row level security;
drop policy if exists "company followup steps" on public.followup_steps;
create policy "company followup steps" on public.followup_steps for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Histórico ───────────────────────────────────────────────────────────────
create table if not exists public.followup_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  step_id uuid references public.followup_steps(id) on delete set null,
  step_order smallint not null,
  kind text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  content text,
  message_ref text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_followup_logs_company
  on public.followup_logs(company_id, created_at desc);
create index if not exists idx_followup_logs_contact
  on public.followup_logs(contact_id, created_at desc);

alter table public.followup_logs enable row level security;
drop policy if exists "company followup logs" on public.followup_logs;
create policy "company followup logs" on public.followup_logs for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

notify pgrst, 'reload schema';
