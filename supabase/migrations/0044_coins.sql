-- Consumo em coins: medir o que cada empresa gasta e poder limitar.
--
-- Todo envio custa dinheiro de alguém. Hoje custa do dono da plataforma: a
-- resposta do SDR IA gasta OpenAI, o disparo gasta janela de API. Sem medição
-- não há como cobrar por uso nem descobrir quem consome fora da curva — e o
-- primeiro cliente que dispara 50 mil mensagens vira prejuízo silencioso.
--
-- Três peças:
--   usage_kinds   -> quanto custa cada tipo de evento (editável, sem deploy)
--   company_plans -> a cota da empresa. Sem linha = ilimitado, só mede.
--   usage_events  -> o extrato, uma linha por envio
--
-- "Sem linha = ilimitado" é deliberado: as empresas que já existem não podem
-- parar de atender porque uma migration inventou um teto para elas. O limite
-- passa a valer quando alguém o define na tela.

create table public.usage_kinds (
  key text primary key,
  label text not null,
  -- numeric porque nem tudo custa 1: e-mail vale 0,1 (dez e-mails = 1 coin).
  coins numeric(10,3) not null default 1,
  position int not null default 0
);

create table public.company_plans (
  company_id uuid primary key references public.companies(id) on delete cascade,
  monthly_coins int not null default 2000,
  -- true: passa do teto e a conta vai para o pós-pago; false: bloqueia o envio.
  allow_overage boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null references public.usage_kinds(key),
  coins numeric(10,3) not null,
  -- Sem FK: o extrato sobrevive ao contato apagado. Cobrança não pode sumir
  -- porque alguém limpou a base.
  contact_id uuid,
  /** message_ref, id de campanha — para auditar uma cobrança contestada. */
  ref text,
  created_at timestamptz not null default now()
);

-- A consulta que importa é sempre "quanto esta empresa gastou neste mês".
create index idx_usage_events_company_date
  on public.usage_events(company_id, created_at desc);

alter table public.usage_kinds enable row level security;
alter table public.company_plans enable row level security;
alter table public.usage_events enable row level security;

create policy "todos leem tipos de consumo" on public.usage_kinds for select using (true);
create policy "super admin edita tipos" on public.usage_kinds for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- A empresa vê o próprio plano e o próprio extrato: é a conta dela. Quem
-- define a cota é o super admin.
create policy "empresa le o proprio plano" on public.company_plans for select
  using (company_id in (select public.my_company_ids()) or public.is_super_admin());
create policy "super admin edita planos" on public.company_plans for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "empresa le o proprio extrato" on public.usage_events for select
  using (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Leitura: quanto foi gasto no mês corrente ───────────────────────────────
create or replace function public.company_usage(p_company_id uuid)
returns table (
  used numeric,
  monthly_coins int,
  allow_overage boolean,
  remaining numeric,
  period_start timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with periodo as (
    select date_trunc('month', now()) as inicio
  ),
  gasto as (
    select coalesce(sum(e.coins), 0) as total
    from public.usage_events e, periodo p
    where e.company_id = p_company_id and e.created_at >= p.inicio
  ),
  plano as (
    select monthly_coins, allow_overage
    from public.company_plans where company_id = p_company_id
  )
  select
    gasto.total,
    plano.monthly_coins,
    coalesce(plano.allow_overage, true),
    case when plano.monthly_coins is null then null
         else plano.monthly_coins - gasto.total end,
    periodo.inicio
  from gasto, periodo
  left join plano on true
  where
    p_company_id in (select public.my_company_ids())
    or public.is_super_admin()
    or coalesce(
         nullif(current_setting('request.jwt.claim.role', true), ''),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
       ) = 'service_role';
$$;

grant execute on function public.company_usage(uuid) to authenticated;

-- ── Escrita: cobra e devolve se pode ────────────────────────────────────────
/**
 * Cobra um evento e diz se ele pode acontecer.
 *
 * Checar e gravar na mesma chamada é o ponto: separado, dois envios simultâneos
 * leem o mesmo saldo e os dois passam. Aqui o insert só existe quando a
 * resposta é `allowed`, e o extrato nunca cobra por envio recusado.
 *
 * Só a chave de serviço cobra — quem chama é edge function. O browser não tem
 * como criar consumo, senão o extrato viraria ficção.
 */
create or replace function public.consume_coins(
  p_company_id uuid,
  p_kind text,
  p_contact_id uuid default null,
  p_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service boolean;
  v_coins numeric;
  v_plan record;
  v_used numeric;
begin
  v_is_service := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  ) = 'service_role';

  if not v_is_service then
    return jsonb_build_object('allowed', false, 'reason', 'forbidden');
  end if;

  select coins into v_coins from public.usage_kinds where key = p_kind;
  -- Tipo desconhecido não bloqueia atendimento: mede como 1 e segue.
  if v_coins is null then
    v_coins := 1;
  end if;

  select monthly_coins, allow_overage into v_plan
  from public.company_plans where company_id = p_company_id;

  -- Sem plano definido: ilimitado. Registra o consumo e libera.
  if v_plan.monthly_coins is null then
    insert into public.usage_events (company_id, kind, coins, contact_id, ref)
    values (p_company_id, p_kind, v_coins, p_contact_id, p_ref);
    return jsonb_build_object('allowed', true, 'coins', v_coins, 'unlimited', true);
  end if;

  select coalesce(sum(coins), 0) into v_used
  from public.usage_events
  where company_id = p_company_id and created_at >= date_trunc('month', now());

  if v_used + v_coins > v_plan.monthly_coins and not v_plan.allow_overage then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'limit',
      'used', v_used,
      'monthly_coins', v_plan.monthly_coins
    );
  end if;

  insert into public.usage_events (company_id, kind, coins, contact_id, ref)
  values (p_company_id, p_kind, v_coins, p_contact_id, p_ref);

  return jsonb_build_object(
    'allowed', true,
    'coins', v_coins,
    'used', v_used + v_coins,
    'monthly_coins', v_plan.monthly_coins
  );
end;
$$;

-- ── Semente ─────────────────────────────────────────────────────────────────
-- Preços na mesma ordem de grandeza da tabela da Zoppy (1 disparo = 1 coin,
-- 10 e-mails = 1 coin). A resposta da IA entra na conta porque ela gasta
-- OpenAI de verdade — quem paga hoje é a plataforma.
insert into public.usage_kinds (key, label, coins, position) values
  ('whatsapp_out', 'Mensagem enviada no WhatsApp', 1,    10),
  ('ai_reply',     'Resposta do SDR IA',           1,    20),
  ('campaign_out', 'Disparo de campanha',          1,    30),
  ('followup_out', 'Follow-up automático',         1,    40),
  ('email_out',    'E-mail enviado',               0.1,  50);

notify pgrst, 'reload schema';
