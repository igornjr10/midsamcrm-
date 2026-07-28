-- Disparo em massa (campanhas) usando templates aprovados pela Meta.
-- Fora da janela de 24h so e possivel iniciar conversa com template aprovado,
-- entao cada campanha guarda o template escolhido + o mapeamento de variaveis,
-- e cada destinatario vira uma linha em campaign_targets com status proprio.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  template_name text not null,
  template_language text not null default 'pt_BR',
  -- Corpo do template com placeholders {{1}}, guardado para renderizar a
  -- previa no chat/historico sem precisar consultar a Meta de novo.
  template_body text,
  -- { header: [...], body: [...], header_media_url, header_media_type }
  variable_map jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'done', 'canceled')),
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  message_ref text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index idx_campaigns_company on public.campaigns(company_id, created_at desc);
create index idx_campaign_targets_campaign on public.campaign_targets(campaign_id, status);
create index idx_campaign_targets_ref on public.campaign_targets(message_ref)
  where message_ref is not null;

create trigger update_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.update_updated_at_column();

alter table public.campaigns enable row level security;
create policy "company campaigns" on public.campaigns for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

alter table public.campaign_targets enable row level security;
create policy "company campaign targets" on public.campaign_targets for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- Recalcula os contadores a partir dos targets. Chamada pelo dispatcher a cada
-- lote e pelo webhook quando chega status de entrega; conclui a campanha
-- automaticamente quando nao sobra ninguem pendente.
create or replace function public.recount_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.campaigns c
  set sent_count = t.sent,
      failed_count = t.failed,
      status = case when c.status = 'running' and t.pending = 0 then 'done' else c.status end,
      finished_at = case
        when c.status = 'running' and t.pending = 0 then now()
        else c.finished_at
      end
  from (
    select
      count(*) filter (where status in ('sent', 'delivered', 'read')) as sent,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'pending') as pending
    from public.campaign_targets
    where campaign_id = p_campaign_id
  ) t
  where c.id = p_campaign_id;
end;
$$;

grant execute on function public.recount_campaign(uuid) to authenticated, service_role;
