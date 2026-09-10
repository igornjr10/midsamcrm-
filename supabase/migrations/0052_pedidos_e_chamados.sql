-- Pedidos e Chamados: as duas abas novas de verdade.
--
-- O funil de vendas não descreve nem o restaurante nem a administradora.
-- Ninguém "avança de etapa": faz um pedido, abre um chamado. As duas coisas
-- nascem no chat, precisam de um número que o cliente possa citar, um status
-- que a equipe move e um lugar para ver tudo o que está aberto.
--
-- Dois módulos (features) para o pacote de cada nicho decidir. Alimentação e
-- Moda ganham Pedidos; Administradora e Corretora ganham Chamados. Quem não
-- tem no pacote liga por exceção na tela de Empresas, como qualquer módulo.

insert into public.features (key, label, description, route, core, position) values
  ('pedidos',  'Pedidos',  'Pedidos dos clientes com itens e status',            '/pedidos',  false, 45),
  ('chamados', 'Chamados', 'Solicitações com protocolo, prazo e responsável',    '/chamados', false, 46)
on conflict (key) do nothing;

insert into public.niche_features (niche_key, feature_key) values
  ('alimentacao',    'pedidos'),
  ('moda',           'pedidos'),
  ('administradora', 'chamados'),
  ('corretora',      'chamados'),
  ('geral',          'pedidos'),
  ('geral',          'chamados')
on conflict do nothing;

-- ── Número sequencial por empresa ───────────────────────────────────────────
-- "Pedido 37", "Protocolo 128": o cliente cita o número, então ele precisa ser
-- curto e começar do 1 em cada empresa. Uma função só serve às duas tabelas.
create or replace function public.set_company_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is null then
    execute format(
      'select coalesce(max(number), 0) + 1 from public.%I where company_id = $1',
      tg_table_name
    ) into new.number using new.company_id;
  end if;
  return new;
end;
$$;

-- ── Pedidos ─────────────────────────────────────────────────────────────────
-- Prefixo crm_: o projeto Supabase já tinha uma tabela `orders` de outro app,
-- e `tickets` é nome comum demais para arriscar o mesmo choque.
create table public.crm_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  number int,
  /** [{ name, qty, price }] — preço unitário, pode ser null quando a IA não sabe. */
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2),
  status text not null default 'recebido'
    check (status in ('recebido', 'preparo', 'saiu', 'entregue', 'cancelado')),
  delivery_address text,
  notes text,
  /** 'ai' quando a IA registrou a partir da conversa. */
  created_by text not null default 'user' check (created_by in ('user', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_orders_company_status on public.crm_orders(company_id, status, created_at desc);
create index idx_orders_contact on public.crm_orders(contact_id) where contact_id is not null;

alter table public.crm_orders enable row level security;
create policy "company orders" on public.crm_orders for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger set_orders_number before insert on public.crm_orders
  for each row execute function public.set_company_number();
create trigger update_orders_updated_at before update on public.crm_orders
  for each row execute function public.update_updated_at_column();

-- ── Chamados ────────────────────────────────────────────────────────────────
create table public.crm_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  number int,
  title text not null,
  description text,
  category text,
  status text not null default 'aberto'
    check (status in ('aberto', 'em_andamento', 'aguardando', 'resolvido', 'cancelado')),
  priority text not null default 'normal'
    check (priority in ('baixa', 'normal', 'alta', 'urgente')),
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  resolved_at timestamptz,
  created_by text not null default 'user' check (created_by in ('user', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_tickets_company_status on public.crm_tickets(company_id, status, created_at desc);
create index idx_tickets_contact on public.crm_tickets(contact_id) where contact_id is not null;

alter table public.crm_tickets enable row level security;
create policy "company tickets" on public.crm_tickets for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger set_tickets_number before insert on public.crm_tickets
  for each row execute function public.set_company_number();
create trigger update_tickets_updated_at before update on public.crm_tickets
  for each row execute function public.update_updated_at_column();

-- resolved_at acompanha o status: é a data que o relatório de prazo vai usar.
create or replace function public.set_ticket_resolved_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolvido' and (old.status is distinct from 'resolvido') then
    new.resolved_at := now();
  elsif new.status <> 'resolvido' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger set_ticket_resolved_at before update of status on public.crm_tickets
  for each row execute function public.set_ticket_resolved_at();

notify pgrst, 'reload schema';
