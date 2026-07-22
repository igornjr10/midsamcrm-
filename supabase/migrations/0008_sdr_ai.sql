-- SDR IA: agente que responde leads automaticamente no WhatsApp.
-- Config por empresa; pausa individual por contato (handoff humano).

create table public.ai_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  system_prompt text,
  model text not null default 'gpt-4o-mini',
  openai_api_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_configs enable row level security;
create policy "company ai config" on public.ai_configs for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_ai_configs_updated_at
  before update on public.ai_configs
  for each row execute function public.update_updated_at_column();

-- Pausa da IA por contato: quando o humano assume, a IA para de responder.
alter table public.contacts add column ai_paused boolean not null default false;

-- Mensagens da IA usam sender = 'ai'.
alter table public.conversations drop constraint conversations_sender_check;
alter table public.conversations add constraint conversations_sender_check
  check (sender in ('user', 'contact', 'ai'));
