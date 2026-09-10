-- Sub-registros do contato: apólices, pacotes de sessões, unidades.
--
-- Um contato tem um nome e um telefone. Uma corretora tem, por contato, duas
-- apólices com vencimentos diferentes; uma clínica tem um pacote de dez
-- sessões; uma administradora tem a unidade 302 do bloco B. Isso não cabe em
-- campo do contato (que é um valor só) nem merece uma tabela por nicho.
--
-- Uma base só: o tipo de registro (record_types) descreve os campos e diz
-- qual deles é a data principal; o registro (contact_records) guarda os
-- valores. A data principal é denormalizada em main_date para as réguas por
-- data e as listas ordenadas por vencimento não abrirem o jsonb.

-- ── Tipos de registro ───────────────────────────────────────────────────────
create table public.record_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  /** "Apólice" */
  label text not null,
  /** "Apólices" */
  label_plural text not null,
  /** [{ key, label, type, options }] — mesmo formato de contact_fields. */
  fields jsonb not null default '[]'::jsonb,
  /** Qual campo é a data principal (vencimento, validade). Null = nenhuma. */
  date_field_key text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

alter table public.record_types enable row level security;

create policy "company record types" on public.record_types for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_record_types_updated_at
  before update on public.record_types
  for each row execute function public.update_updated_at_column();

-- ── Registros ───────────────────────────────────────────────────────────────
create table public.contact_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  type_key text not null,
  title text not null,
  fields jsonb not null default '{}'::jsonb,
  /** Cópia de fields[date_field_key], mantida por trigger. */
  main_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contact_records_contact on public.contact_records(contact_id);
create index idx_contact_records_type_date
  on public.contact_records(company_id, type_key, main_date);

alter table public.contact_records enable row level security;

create policy "company contact records" on public.contact_records for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_contact_records_updated_at
  before update on public.contact_records
  for each row execute function public.update_updated_at_column();

create or replace function public.set_contact_record_main_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select date_field_key into v_key
  from public.record_types
  where company_id = new.company_id and key = new.type_key;
  new.main_date := case when v_key is null then null else public.try_date(new.fields ->> v_key) end;
  return new;
end;
$$;

create trigger set_contact_record_main_date
  before insert or update of fields, type_key on public.contact_records
  for each row execute function public.set_contact_record_main_date();

-- Trocar a data principal do tipo recalcula os registros que já existem.
create or replace function public.recompute_records_main_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contact_records r
  set main_date = case when new.date_field_key is null then null
                       else public.try_date(r.fields ->> new.date_field_key) end
  where r.company_id = new.company_id and r.type_key = new.key;
  return new;
end;
$$;

create trigger recompute_records_main_date
  after update of date_field_key on public.record_types
  for each row execute function public.recompute_records_main_date();

-- ── Réguas por data enxergam os registros ───────────────────────────────────
-- field_key 'record:apolice' = a data principal dos registros do tipo apolice.
-- Um contato com duas apólices vencendo entra uma vez por volta (o cooldown é
-- por contato); o registro mais próximo dá o {{data}} e o {{titulo}}.
drop function if exists public.relationship_rule_targets(uuid, int);

create or replace function public.relationship_rule_targets(
  p_rule_id uuid,
  p_limit int default 200
)
returns table (contact_id uuid, name text, phone text, field_value text, record_title text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_tz text;
  v_today date;
  v_record_type text;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
     ) <> 'service_role' then
    return;
  end if;

  select * into v_rule
  from public.relationship_rules
  where id = p_rule_id and enabled;
  if v_rule.id is null then
    return;
  end if;

  select coalesce(followup_timezone, 'America/Sao_Paulo') into v_tz
  from public.ai_configs where company_id = v_rule.company_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_today := (now() at time zone v_tz)::date;
  v_record_type := case when v_rule.field_key like 'record:%' then substr(v_rule.field_key, 8) end;

  return query
  select
    c.id,
    c.name,
    c.phone,
    case
      when v_rule.kind <> 'data' then null
      when v_record_type is not null then (
        select r.main_date::text from public.contact_records r
        where r.contact_id = c.id and r.type_key = v_record_type
          and r.main_date is not null
          and (r.main_date + v_rule.offset_days) between (v_today - 2) and v_today
        order by r.main_date limit 1)
      else c.fields ->> v_rule.field_key
    end,
    case
      when v_record_type is null then null
      else (
        select r.title from public.contact_records r
        where r.contact_id = c.id and r.type_key = v_record_type
          and r.main_date is not null
          and (r.main_date + v_rule.offset_days) between (v_today - 2) and v_today
        order by r.main_date limit 1)
    end
  from public.contacts c
  where c.company_id = v_rule.company_id
    and c.phone is not null
    and length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
    and not exists (
      select 1 from public.relationship_logs l
      where l.contact_id = c.id
        and l.status = 'sent'
        and case when v_rule.kind = 'data' then l.rule_id = v_rule.id else l.kind = v_rule.kind end
        and l.created_at > now() - make_interval(days => v_rule.cooldown_days)
    )
    and case v_rule.kind
      when 'aniversario' then
        c.birth_date is not null
        and extract(month from c.birth_date) = extract(month from v_today)
        and extract(day   from c.birth_date) = extract(day   from v_today)
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
      when 'data' then
        v_rule.field_key is not null
        and case
          when v_record_type is not null then exists (
            select 1 from public.contact_records r
            where r.contact_id = c.id and r.type_key = v_record_type
              and r.main_date is not null
              and (r.main_date + v_rule.offset_days) between (v_today - 2) and v_today)
          else
            public.try_date(c.fields ->> v_rule.field_key) is not null
            and (public.try_date(c.fields ->> v_rule.field_key) + v_rule.offset_days)
                between (v_today - 2) and v_today
        end
      else false
    end
  order by c.last_interaction_at nulls last
  limit p_limit;
end;
$$;

-- ── Modelos por nicho ───────────────────────────────────────────────────────
create table public.niche_record_types (
  niche_key text not null references public.niches(key) on delete cascade,
  key text not null,
  label text not null,
  label_plural text not null,
  fields jsonb not null default '[]'::jsonb,
  date_field_key text,
  position int not null default 0,
  primary key (niche_key, key)
);

alter table public.niche_record_types enable row level security;
create policy "todos leem niche_record_types" on public.niche_record_types for select using (true);
create policy "super admin edita niche_record_types" on public.niche_record_types for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.seed_niche_record_types(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_niche text;
  v_n int := 0;
begin
  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return 0;
  end if;
  insert into public.record_types (company_id, key, label, label_plural, fields, date_field_key, position)
  select p_company_id, t.key, t.label, t.label_plural, t.fields, t.date_field_key, t.position
  from public.niche_record_types t
  where t.niche_key = v_niche
  on conflict (company_id, key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.seed_niche_record_types(uuid) from public;

create or replace function public.apply_niche_template(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_niche text;
  v_open_max int;
  v_stages int := 0;
  v_removed int := 0;
  v_fields int := 0;
  v_kinds int := 0;
  v_rules int := 0;
  v_records int := 0;
  v_extra jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Somente o super admin aplica modelos de nicho';
  end if;

  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return jsonb_build_object(
      'stages', 0, 'removed', 0, 'fields', 0, 'kinds', 0, 'rules', 0, 'tags', 0, 'replies', 0, 'records', 0
    );
  end if;

  select coalesce(max(position), 0) into v_open_max
  from public.pipeline_stages
  where company_id = p_company_id and kind = 'open';

  insert into public.pipeline_stages (company_id, key, name, tone, kind, position)
  select p_company_id, ns.key, ns.name, ns.tone, ns.kind, v_open_max + ns.position
  from public.niche_stages ns
  where ns.niche_key = v_niche
  on conflict (company_id, key) do nothing;
  get diagnostics v_stages = row_count;

  if v_stages > 0 then
    delete from public.pipeline_stages s
    where s.company_id = p_company_id
      and s.kind = 'open'
      and s.key in ('contacted', 'proposal', 'negotiation')
      and not exists (
        select 1 from public.niche_stages ns where ns.niche_key = v_niche and ns.key = s.key
      )
      and not exists (
        select 1 from public.contacts c where c.company_id = p_company_id and c.stage = s.key
      );
    get diagnostics v_removed = row_count;
  end if;

  with ordered as (
    select id, row_number() over (order by (kind <> 'open'), (kind = 'lost'), position) as rn
    from public.pipeline_stages
    where company_id = p_company_id
  )
  update public.pipeline_stages s
  set position = o.rn
  from ordered o
  where o.id = s.id and s.position <> o.rn;

  insert into public.contact_fields (company_id, key, label, type, options, show_on_card, position)
  select p_company_id, nf.key, nf.label, nf.type, nf.options, nf.show_on_card, nf.position
  from public.niche_fields nf
  where nf.niche_key = v_niche
  on conflict (company_id, key) do nothing;
  get diagnostics v_fields = row_count;

  insert into public.appointment_kinds (company_id, key, label, tone, position)
  select p_company_id, nk.key, nk.label, nk.tone, nk.position
  from public.niche_appointment_kinds nk
  where nk.niche_key = v_niche
  on conflict (company_id, key) do nothing;
  get diagnostics v_kinds = row_count;

  -- Tipos de registro antes das réguas: a régua 'record:apolice' pressupõe o tipo.
  v_records := public.seed_niche_record_types(p_company_id);
  v_rules := public.seed_niche_rules(p_company_id);
  v_extra := public.seed_niche_tags_and_replies(p_company_id);

  return jsonb_build_object(
    'stages', v_stages,
    'removed', v_removed,
    'fields', v_fields,
    'kinds', v_kinds,
    'rules', v_rules,
    'tags', v_extra -> 'tags',
    'replies', v_extra -> 'replies',
    'records', v_records
  );
end;
$$;

-- ── Semente ─────────────────────────────────────────────────────────────────
insert into public.niche_record_types (niche_key, key, label, label_plural, fields, date_field_key, position) values
  ('corretora', 'apolice', 'Apólice', 'Apólices', '[
    {"key": "tipo",       "label": "Tipo",           "type": "select", "options": ["Auto", "Vida", "Saúde", "Residencial", "Consórcio", "Outro"]},
    {"key": "seguradora", "label": "Seguradora",     "type": "text",   "options": []},
    {"key": "numero",     "label": "Nº da apólice",  "type": "text",   "options": []},
    {"key": "premio",     "label": "Prêmio (R$)",    "type": "number", "options": []},
    {"key": "vencimento", "label": "Vencimento",     "type": "date",   "options": []}
  ]'::jsonb, 'vencimento', 1),

  ('estetica', 'pacote', 'Pacote de sessões', 'Pacotes', '[
    {"key": "procedimento", "label": "Procedimento",      "type": "text",   "options": []},
    {"key": "total",        "label": "Sessões no pacote", "type": "number", "options": []},
    {"key": "restantes",    "label": "Sessões restantes", "type": "number", "options": []},
    {"key": "validade",     "label": "Validade",          "type": "date",   "options": []}
  ]'::jsonb, 'validade', 1),

  ('administradora', 'unidade', 'Unidade', 'Unidades', '[
    {"key": "condominio", "label": "Condomínio", "type": "text",   "options": []},
    {"key": "bloco",      "label": "Bloco",      "type": "text",   "options": []},
    {"key": "numero",     "label": "Unidade",    "type": "text",   "options": []},
    {"key": "perfil",     "label": "Perfil",     "type": "select", "options": ["Morador", "Inquilino", "Proprietário", "Síndico"]}
  ]'::jsonb, null, 1)
on conflict do nothing;

-- Corretora: a renovação passa a olhar as apólices, não um campo solto do
-- contato. As réguas de campo saem do modelo (quem já as tem, mantém).
delete from public.niche_rules where niche_key = 'corretora' and field_key = 'vencimento';
insert into public.niche_rules (niche_key, field_key, offset_days, title, message, cooldown_days) values
  ('corretora', 'record:apolice', -30, 'Renovação em 30 dias',
   'Oi {{primeiro_nome}}! Sua apólice {{titulo}} vence em {{data}}. Já estou cotando a renovação para você não ficar descoberto — posso te mandar as opções esta semana?', 20),
  ('corretora', 'record:apolice', -7, 'Renovação em 7 dias',
   '{{primeiro_nome}}, faltam 7 dias para a apólice {{titulo}} vencer ({{data}}). Me confirma se seguimos com a renovação para eu emitir a tempo?', 20),
  ('estetica', 'record:pacote', -7, 'Pacote vencendo',
   'Oi {{primeiro_nome}}! Seu pacote {{titulo}} vence em {{data}}. Quer agendar as sessões que faltam antes disso?', 30)
on conflict do nothing;

-- Empresas com nicho recebem os tipos e as réguas novas agora.
select public.seed_niche_record_types(id) from public.companies where niche_key is not null;
select public.seed_niche_rules(id) from public.companies where niche_key is not null;

notify pgrst, 'reload schema';
