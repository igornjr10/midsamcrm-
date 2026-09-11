-- Pacote de varejo de moda: vendas, giftback, segmentos, tarefas e captação.
--
-- Uma loja de roupa não vive de funil: vive de recompra. O que ela precisa
-- ver é quem comprou, quanto, há quanto tempo, e o que fazer para trazer de
-- volta. Este pacote coloca a venda no centro e liga o resto a ela:
--
--   crm_sales              -> a venda (manual, planilha, pedido entregue, captação)
--   crm_coupons            -> giftback gerado pela venda e cupons avulsos
--   crm_giftback_settings  -> a regra do giftback e da tarefa de pós-venda
--   crm_segments           -> recortes salvos da base (RFM, recência, gasto...)
--   crm_tasks              -> painel do vendedor: pós-venda, NPS, aniversário
--   crm_lead_forms         -> pop-up de captação com script embutível
--
-- Seis módulos novos, no pacote de Moda e Geral. Prefixo crm_ como na 0052.

-- ── Módulos ─────────────────────────────────────────────────────────────────
insert into public.features (key, label, description, route, core, position) values
  ('dashboard', 'Dashboard',          'Receita, RFM, NPS, recompra e produtos',          '/dashboard', false, 5),
  ('vendas',    'Vendas',             'Lançamento e importação de vendas',               '/vendas',    false, 22),
  ('vendedor',  'Painel do Vendedor', 'Tarefas de pós-venda, NPS e aniversário',         '/vendedor',  false, 24),
  ('segmentos', 'Segmentos',          'Recortes salvos da base para campanhas',          '/segmentos', false, 52),
  ('bonus',     'Bônus',              'Giftback e cupons',                               '/bonus',     false, 53),
  ('captacao',  'Captação',           'Pop-up de captação de leads no site',             '/captacao',  false, 54)
on conflict (key) do nothing;

insert into public.niche_features (niche_key, feature_key)
select n.key, f.key
from (values ('moda'), ('geral')) as n(key)
cross join (values ('dashboard'), ('vendas'), ('vendedor'), ('segmentos'), ('bonus'), ('captacao')) as f(key)
on conflict do nothing;

-- Gênero e numeração já vêm da 0048 (numeracao, interesse); gênero entra agora.
insert into public.niche_fields (niche_key, key, label, type, options, show_on_card, position) values
  ('moda', 'genero', 'Gênero', 'select', array['Feminino', 'Masculino', 'Outro'], false, 4)
on conflict do nothing;

-- ── Regra do giftback ───────────────────────────────────────────────────────
create table public.crm_giftback_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  /** % da venda que vira crédito. */
  percent numeric(5,2) not null default 5,
  validity_days int not null default 30,
  min_purchase numeric(12,2) not null default 0,
  prefix text not null default 'GB',
  send_message boolean not null default true,
  /** Aceita {{primeiro_nome}}, {{codigo}}, {{valor}}, {{validade}}. */
  message text not null default 'Oi {{primeiro_nome}}! Obrigado pela compra 💜 Você ganhou {{valor}} de giftback para usar até {{validade}}. Seu código: {{codigo}}',
  reminder_days int not null default 3,
  reminder_message text not null default 'Oi {{primeiro_nome}}! Seu giftback de {{valor}} vence em {{validade}}. Passa aqui para usar: {{codigo}} 😉',
  /** Dias após a venda para a tarefa de pós-venda cair no painel do vendedor. 0 = não cria. */
  post_sale_task_days int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_giftback_settings enable row level security;
create policy "company giftback settings" on public.crm_giftback_settings for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());
create trigger update_crm_giftback_settings_updated_at before update on public.crm_giftback_settings
  for each row execute function public.update_updated_at_column();

-- ── Vendas ──────────────────────────────────────────────────────────────────
create table public.crm_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  number int,
  total numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  /** [{ name, qty, price }] */
  items jsonb not null default '[]'::jsonb,
  /** Vendedor (auth.users). Null = não informado. */
  seller_id uuid references auth.users(id) on delete set null,
  store text,
  origin text not null default 'manual'
    check (origin in ('manual', 'planilha', 'pedido', 'captacao')),
  /** Pedido que virou venda ao ser entregue. */
  order_id uuid unique references public.crm_orders(id) on delete set null,
  coupon_id uuid,
  coupon_code text,
  status text not null default 'pago' check (status in ('pago', 'cancelado')),
  sold_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_crm_sales_company_date on public.crm_sales(company_id, sold_at desc);
create index idx_crm_sales_contact on public.crm_sales(contact_id) where contact_id is not null;

alter table public.crm_sales enable row level security;
create policy "company crm sales" on public.crm_sales for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger crm_set_sales_number before insert on public.crm_sales
  for each row execute function public.crm_set_company_number();
create trigger update_crm_sales_updated_at before update on public.crm_sales
  for each row execute function public.update_updated_at_column();

-- ── Cupons e giftback ───────────────────────────────────────────────────────
create table public.crm_coupons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  /** Giftback é pessoal; cupom pode ser de todo mundo (null). */
  contact_id uuid references public.contacts(id) on delete cascade,
  code text not null,
  kind text not null check (kind in ('giftback', 'cupom')),
  discount_type text not null default 'fixed' check (discount_type in ('fixed', 'percent')),
  value numeric(12,2) not null,
  min_purchase numeric(12,2),
  expires_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo', 'usado', 'expirado', 'cancelado')),
  /** Venda que gerou o giftback e venda em que foi usado. */
  origin_sale_id uuid references public.crm_sales(id) on delete set null,
  used_sale_id uuid references public.crm_sales(id) on delete set null,
  used_at timestamptz,
  sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create index idx_crm_coupons_company_status on public.crm_coupons(company_id, status, expires_at);
create index idx_crm_coupons_contact on public.crm_coupons(contact_id) where contact_id is not null;

alter table public.crm_coupons enable row level security;
create policy "company crm coupons" on public.crm_coupons for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

alter table public.crm_sales
  add constraint crm_sales_coupon_fk foreign key (coupon_id) references public.crm_coupons(id) on delete set null;

/** Código curto e legível: prefixo + 6 caracteres sem 0/O/1/I. */
create or replace function public.crm_coupon_code(p_prefix text)
returns text
language plpgsql
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return upper(coalesce(nullif(trim(p_prefix), ''), 'GB')) || '-' || v_code;
end;
$$;

-- ── O que uma venda dispara ─────────────────────────────────────────────────
-- Tudo no banco, para valer igual para venda manual, planilha e pedido:
--   1. marca o cupom usado
--   2. gera o giftback da compra
--   3. abre a tarefa de pós-venda para o vendedor
create or replace function public.crm_after_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.crm_giftback_settings;
  v_code text;
  v_value numeric;
begin
  if new.status <> 'pago' then
    return new;
  end if;

  if new.coupon_id is not null then
    update public.crm_coupons
    set status = 'usado', used_sale_id = new.id, used_at = new.sold_at
    where id = new.coupon_id and status = 'ativo';
  end if;

  select * into v_cfg from public.crm_giftback_settings where company_id = new.company_id;

  if v_cfg.company_id is not null and v_cfg.enabled and new.contact_id is not null
     and new.total >= v_cfg.min_purchase and new.origin <> 'planilha' then
    v_value := round(new.total * v_cfg.percent / 100, 2);
    if v_value > 0 then
      -- Tenta até achar um código livre; colisão em 32^6 é rara, mas existe.
      for i in 1..5 loop
        v_code := public.crm_coupon_code(v_cfg.prefix);
        exit when not exists (
          select 1 from public.crm_coupons where company_id = new.company_id and code = v_code
        );
      end loop;
      insert into public.crm_coupons
        (company_id, contact_id, code, kind, discount_type, value, expires_at, origin_sale_id)
      values
        (new.company_id, new.contact_id, v_code, 'giftback', 'fixed', v_value,
         new.sold_at + make_interval(days => v_cfg.validity_days), new.id);
    end if;
  end if;

  if v_cfg.company_id is not null and v_cfg.post_sale_task_days > 0 and new.contact_id is not null
     and new.origin <> 'planilha' then
    insert into public.crm_tasks (company_id, contact_id, assigned_to, title, kind, due_at, sale_id, created_by)
    values (
      new.company_id, new.contact_id, new.seller_id,
      'Pós-venda: perguntar como foi a compra #' || coalesce(new.number::text, ''),
      'pos_venda', new.sold_at + make_interval(days => v_cfg.post_sale_task_days), new.id, 'auto'
    );
  end if;

  return new;
end;
$$;

-- ── Painel do vendedor ──────────────────────────────────────────────────────
create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  kind text not null default 'outro'
    check (kind in ('pos_venda', 'nps', 'aniversario', 'recompra', 'giftback', 'outro')),
  due_at timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'feita', 'ignorada')),
  sale_id uuid references public.crm_sales(id) on delete set null,
  notes text,
  created_by text not null default 'user' check (created_by in ('user', 'auto')),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_crm_tasks_company_due on public.crm_tasks(company_id, status, due_at);

alter table public.crm_tasks enable row level security;
create policy "company crm tasks" on public.crm_tasks for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());
create trigger update_crm_tasks_updated_at before update on public.crm_tasks
  for each row execute function public.update_updated_at_column();

create trigger crm_after_sale after insert on public.crm_sales
  for each row execute function public.crm_after_sale();

-- Pedido entregue vira venda (uma vez só, por order_id único).
create or replace function public.crm_sale_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue'
     and not exists (select 1 from public.crm_sales where order_id = new.id) then
    insert into public.crm_sales (company_id, contact_id, total, items, origin, order_id, sold_at, notes)
    values (new.company_id, new.contact_id, coalesce(new.total, 0), new.items, 'pedido', new.id, now(),
            'Pedido #' || coalesce(new.number::text, ''));
  end if;
  return new;
end;
$$;

create trigger crm_sale_from_order after update of status on public.crm_orders
  for each row execute function public.crm_sale_from_order();

-- ── Segmentos ───────────────────────────────────────────────────────────────
create table public.crm_segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  /** { rfm: [...], last_purchase_days: {min,max}, purchases: {min,max}, spent: {min,max},
        tags: [...], stage: [...], birthday_month: bool, has_giftback: bool, gender: [...] } */
  rules jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_segments enable row level security;
create policy "company crm segments" on public.crm_segments for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());
create trigger update_crm_segments_updated_at before update on public.crm_segments
  for each row execute function public.update_updated_at_column();

-- ── Pop-up de captação ──────────────────────────────────────────────────────
create table public.crm_lead_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  /** Vai na URL do script: identifica o formulário sem expor a empresa. */
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  title text not null default 'Ganhe um desconto na primeira compra',
  subtitle text not null default 'Deixe seu WhatsApp e receba o cupom na hora.',
  button_label text not null default 'Quero meu desconto',
  /** Quais campos pedir, na ordem: name, phone, email, birth_date, e chaves de contact_fields. */
  fields jsonb not null default '["name", "phone"]'::jsonb,
  /** Etiqueta aplicada ao contato que entra por aqui. */
  tag text,
  /** Cupom de boas-vindas (% da compra). Null = sem cupom. */
  coupon_percent numeric(5,2),
  coupon_validity_days int not null default 15,
  success_message text not null default 'Pronto! Seu cupom chega no WhatsApp em instantes.',
  theme_color text not null default '#1b56de',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_lead_forms enable row level security;
create policy "company crm lead forms" on public.crm_lead_forms for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());
create trigger update_crm_lead_forms_updated_at before update on public.crm_lead_forms
  for each row execute function public.update_updated_at_column();

-- ── Régua: giftback vencendo ────────────────────────────────────────────────
alter table public.relationship_rules
  drop constraint if exists relationship_rules_kind_check;
alter table public.relationship_rules
  add constraint relationship_rules_kind_check
  check (kind in ('aniversario', 'reativacao', 'nps', 'data', 'agenda', 'giftback'));

notify pgrst, 'reload schema';
