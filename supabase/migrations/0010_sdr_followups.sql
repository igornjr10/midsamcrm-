-- Follow-up automático do SDR IA.
--
-- Cadência de mensagens para leads que pararam de responder: cada empresa
-- define uma sequência de passos (followup_steps) com o tempo de silêncio que
-- dispara cada um. Todo envio (ou tentativa) vira uma linha em followup_logs,
-- que é o histórico mostrado na página do SDR.
--
-- A sequência é sempre contada a partir da última mensagem da conversa: se o
-- contato responde, a contagem zera e o follow-up recomeça do passo 1.

-- ── Configuração (mora junto com a config do agente) ────────────────────────
alter table public.ai_configs
  add column followup_enabled boolean not null default false,
  add column followup_timezone text not null default 'America/Sao_Paulo',
  -- Janela de envio no fuso acima: só dispara entre start e end.
  add column followup_window_start smallint not null default 9
    check (followup_window_start between 0 and 23),
  add column followup_window_end smallint not null default 20
    check (followup_window_end between 1 and 24),
  add column followup_skip_weekends boolean not null default true,
  -- Ignora contatos já marcados como Ganho/Perdido.
  add column followup_only_open_stages boolean not null default true;

-- ── Passos da cadência ──────────────────────────────────────────────────────
create table public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  step_order smallint not null,
  -- Horas de silêncio desde a última mensagem (passo 1) ou desde o follow-up
  -- anterior (demais passos).
  delay_hours numeric(6,2) not null default 24 check (delay_hours > 0),
  -- text     -> envia `message` como está (aceita {{nome}} e {{primeiro_nome}})
  -- ai       -> o agente escreve a mensagem seguindo `message` como instrução
  -- template -> template aprovado na Meta, único que funciona fora das 24h
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

create index idx_followup_steps_company on public.followup_steps(company_id, step_order);

create trigger update_followup_steps_updated_at
  before update on public.followup_steps
  for each row execute function public.update_updated_at_column();

alter table public.followup_steps enable row level security;
create policy "company followup steps" on public.followup_steps for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Histórico ───────────────────────────────────────────────────────────────
-- Uma linha por tentativa. Qualquer linha (sent/failed/skipped) faz a cadência
-- avançar para o passo seguinte, então um passo com erro não fica em loop.
create table public.followup_logs (
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

create index idx_followup_logs_company on public.followup_logs(company_id, created_at desc);
create index idx_followup_logs_contact on public.followup_logs(contact_id, created_at desc);

alter table public.followup_logs enable row level security;
create policy "company followup logs" on public.followup_logs for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Candidatos ao próximo follow-up ─────────────────────────────────────────
-- Devolve, por contato, quando foi a última mensagem, quantos follow-ups já
-- saíram desde a última resposta do contato e quando foi o último deles.
-- O runner decide o passo pelo número de follow-ups já feitos.
create or replace function public.followup_candidates(
  p_company_id uuid,
  p_open_only boolean default true,
  p_limit integer default 200
)
returns table (
  contact_id uuid,
  name text,
  phone text,
  email text,
  stage text,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_followup_at timestamptz,
  followups_done integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone,
    c.email,
    c.stage,
    m.last_inbound_at,
    m.last_message_at,
    f.last_followup_at,
    coalesce(f.done, 0)::integer
  from public.contacts c
  join lateral (
    select
      max(v.created_at) filter (where v.sender = 'contact') as last_inbound_at,
      max(v.created_at) as last_message_at
    from public.conversations v
    where v.contact_id = c.id
  ) m on true
  left join lateral (
    select max(l.created_at) as last_followup_at, count(*) as done
    from public.followup_logs l
    where l.contact_id = c.id
      and (m.last_inbound_at is null or l.created_at > m.last_inbound_at)
  ) f on true
  where c.company_id = p_company_id
    and c.ai_paused = false
    and nullif(trim(c.phone), '') is not null
    and m.last_message_at is not null
    and (not p_open_only or c.stage not in ('won', 'lost'))
  order by m.last_message_at asc
  limit p_limit;
$$;

-- Só o runner (service_role) usa: como é security definer, deixar aberto para
-- authenticated permitiria ler contatos de outra empresa passando outro id.
grant execute on function public.followup_candidates(uuid, boolean, integer) to service_role;

-- ── Gravação da cadência ────────────────────────────────────────────────────
-- Substitui todos os passos da empresa de uma vez. Feito no banco porque
-- apagar + inserir a partir do front deixaria a cadência sem passos se a
-- segunda chamada falhasse (e o unique(company_id, step_order) quebraria em
-- qualquer reordenação).
create or replace function public.save_followup_steps(p_company_id uuid, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (p_company_id in (select public.my_company_ids()) or public.is_super_admin()) then
    raise exception 'Sem permissão para esta empresa';
  end if;

  delete from public.followup_steps where company_id = p_company_id;

  insert into public.followup_steps (
    company_id, step_order, delay_hours, kind, message,
    template_name, template_language, template_body, variable_map, active
  )
  select
    p_company_id,
    t.idx::smallint,
    coalesce((t.s->>'delay_hours')::numeric, 24),
    coalesce(t.s->>'kind', 'text'),
    nullif(t.s->>'message', ''),
    nullif(t.s->>'template_name', ''),
    coalesce(nullif(t.s->>'template_language', ''), 'pt_BR'),
    nullif(t.s->>'template_body', ''),
    coalesce(nullif(t.s->'variable_map', 'null'::jsonb), '{}'::jsonb),
    coalesce((t.s->>'active')::boolean, true)
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as t(s, idx);
end;
$$;

grant execute on function public.save_followup_steps(uuid, jsonb) to authenticated, service_role;
