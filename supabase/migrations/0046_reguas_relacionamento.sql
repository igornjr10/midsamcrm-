-- Réguas de relacionamento: falar com quem já é cliente, sem ninguém lembrar.
--
-- O follow-up que existe desde a 0010 é cobrança: o lead sumiu no meio da
-- conversa e a cadência insiste. Isto aqui é outra coisa — o gatilho não é o
-- silêncio, é uma data (aniversário), um tempo parado (reativação) ou um
-- negócio fechado (NPS). Por isso tabela própria em vez de mais um tipo de
-- passo no followup_steps, que teria que ganhar um "quando" para cada régua.
--
-- Três réguas, escolhidas por dependerem só do que o CRM já sabe:
--   aniversario  -> contacts.birth_date (novo)
--   reativacao   -> contacts.last_interaction_at (existe desde a 0019)
--   nps          -> etapa de Ganho no funil (pipeline_stages.kind = 'won')

-- ── O que faltava no contato ────────────────────────────────────────────────
alter table public.contacts
  add column if not exists birth_date date,
  -- 0 a 10, como o cliente respondeu no WhatsApp.
  add column if not exists nps_score smallint,
  add column if not exists nps_asked_at timestamptz,
  add column if not exists nps_answered_at timestamptz;

alter table public.contacts
  drop constraint if exists contacts_nps_score_check;
alter table public.contacts
  add constraint contacts_nps_score_check
  check (nps_score is null or (nps_score between 0 and 10));

comment on column public.contacts.birth_date is
  'Data de nascimento. Só o dia e o mês são usados pela régua de aniversário.';
comment on column public.contacts.nps_asked_at is
  'Quando a pesquisa foi enviada. É a janela em que uma resposta "9" vira nota, e não mensagem comum.';

-- Aniversariantes do dia: a régua pergunta por dia e mês, não pela data cheia.
create index if not exists idx_contacts_birthday
  on public.contacts(company_id, (extract(month from birth_date)), (extract(day from birth_date)))
  where birth_date is not null;

-- ── As réguas ───────────────────────────────────────────────────────────────
create table public.relationship_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('aniversario', 'reativacao', 'nps')),
  enabled boolean not null default false,
  /** Aceita {{nome}} e {{primeiro_nome}}, como o follow-up e as campanhas. */
  message text not null,
  /** reativacao: dias parado que disparam a mensagem. */
  inactive_days int not null default 60,
  /** nps: dias depois de fechar o negócio até perguntar. */
  ask_after_days int not null default 3,
  /**
   * Silêncio entre duas mensagens da mesma régua para o mesmo contato.
   * Aniversário não precisa (o dia já é único no ano), mas reativação sem isso
   * mandaria a mesma mensagem todo dia enquanto o contato seguisse parado.
   */
  cooldown_days int not null default 180,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Uma régua de cada tipo por empresa: duas de reativação disputariam o mesmo
  -- contato e o cliente receberia duas mensagens.
  unique (company_id, kind)
);

create table public.relationship_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_id uuid references public.relationship_rules(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete cascade,
  kind text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  content text,
  message_ref text,
  error text,
  created_at timestamptz not null default now()
);

-- É por este índice que o cooldown é verificado, uma vez por contato por volta.
create index idx_relationship_logs_lookup
  on public.relationship_logs(company_id, contact_id, kind, created_at desc);

alter table public.relationship_rules enable row level security;
alter table public.relationship_logs enable row level security;

create policy "company relationship rules" on public.relationship_rules for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create policy "company relationship logs" on public.relationship_logs for select
  using (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_relationship_rules_updated_at
  before update on public.relationship_rules
  for each row execute function public.update_updated_at_column();

-- ── Quem deve receber, agora ────────────────────────────────────────────────
/**
 * Os contatos que a régua alcança nesta volta.
 *
 * A conta mora no banco porque ela é uma consulta: filtrar em TypeScript exigiria
 * trazer a base inteira para a edge function a cada execução, e o cooldown
 * precisa olhar o histórico de envios contato a contato.
 *
 * Só a chave de serviço chama — é a function do cron que envia.
 */
create or replace function public.relationship_targets(
  p_company_id uuid,
  p_kind text,
  p_limit int default 200
)
returns table (contact_id uuid, name text, phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_tz text;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
     ) <> 'service_role' then
    return;
  end if;

  select * into v_rule
  from public.relationship_rules
  where company_id = p_company_id and kind = p_kind and enabled;
  if v_rule.id is null then
    return;
  end if;

  select coalesce(followup_timezone, 'America/Sao_Paulo') into v_tz
  from public.ai_configs where company_id = p_company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');

  return query
  select c.id, c.name, c.phone
  from public.contacts c
  where c.company_id = p_company_id
    and c.phone is not null
    and length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
    -- Cooldown: nada de repetir a mesma régua dentro da janela.
    and not exists (
      select 1 from public.relationship_logs l
      where l.contact_id = c.id
        and l.kind = p_kind
        and l.status = 'sent'
        and l.created_at > now() - make_interval(days => v_rule.cooldown_days)
    )
    and case p_kind
      when 'aniversario' then
        c.birth_date is not null
        and extract(month from c.birth_date) = extract(month from (now() at time zone v_tz))
        and extract(day   from c.birth_date) = extract(day   from (now() at time zone v_tz))
      when 'reativacao' then
        c.last_interaction_at is not null
        and c.last_interaction_at < now() - make_interval(days => v_rule.inactive_days)
      when 'nps' then
        c.nps_asked_at is null
        and exists (
          select 1 from public.pipeline_stages s
          where s.company_id = c.company_id and s.key = c.stage and s.kind = 'won'
        )
        and c.updated_at < now() - make_interval(days => v_rule.ask_after_days)
      else false
    end
  order by c.last_interaction_at nulls last
  limit p_limit;
end;
$$;

-- ── Nicho novo ──────────────────────────────────────────────────────────────
-- Moda pede aniversário mais do que qualquer outro: é o nicho em que lembrar
-- da data vira venda no mesmo dia.
insert into public.niches (key, name, description, position)
values ('moda', 'Moda e Vestuário', 'Lojas de roupa, calçados, acessórios', 15)
on conflict (key) do nothing;

insert into public.niche_features (niche_key, feature_key)
select 'moda', f.key from public.features f
on conflict do nothing;

notify pgrst, 'reload schema';
