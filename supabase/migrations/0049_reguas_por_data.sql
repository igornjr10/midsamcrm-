-- Réguas por campo de data.
--
-- A 0046 trouxe três réguas com gatilho fixo: aniversário, inatividade e
-- negócio ganho. A 0048 deu ao contato campos de data que variam por nicho:
-- data do evento, vencimento da apólice, próximo retorno, vencimento do boleto.
-- Esta migration liga as duas coisas: uma régua do tipo 'data' aponta para um
-- desses campos e dispara N dias antes ou depois dele.
--
-- Uma régua só, parametrizada, no lugar de "renovação", "retorno", "cobrança"
-- e "pós-evento" como tipos separados: o que muda entre elas é o campo e o
-- deslocamento, e o resto (mensagem, janela educada, cooldown, log) é igual.

-- ── A régua ganha campo e deslocamento ──────────────────────────────────────
alter table public.relationship_rules
  drop constraint if exists relationship_rules_kind_check;
alter table public.relationship_rules
  add constraint relationship_rules_kind_check
  check (kind in ('aniversario', 'reativacao', 'nps', 'data'));

alter table public.relationship_rules
  add column if not exists title text,
  add column if not exists field_key text,
  /** Negativo = dias antes da data; positivo = depois; 0 = no dia. */
  add column if not exists offset_days int not null default 0;

comment on column public.relationship_rules.field_key is
  'Régua por data: chave em contact_fields (type = date) que dispara a régua.';

-- As três fixas continuam uma por empresa. 'data' pode ter várias, mas não
-- duas para o mesmo campo e o mesmo deslocamento — seria a mesma mensagem
-- duas vezes no mesmo dia.
alter table public.relationship_rules
  drop constraint if exists relationship_rules_company_id_kind_key;
create unique index relationship_rules_one_per_fixed_kind
  on public.relationship_rules(company_id, kind) where kind <> 'data';
create unique index relationship_rules_one_per_date_offset
  on public.relationship_rules(company_id, field_key, offset_days) where kind = 'data';

-- ── Data que pode não ser data ──────────────────────────────────────────────
-- O valor vem de um jsonb preenchido por gente e por IA. "2026-10-12" vira
-- data; "outubro" vira null em vez de derrubar a consulta inteira.
create or replace function public.try_date(p text)
returns date
language plpgsql
immutable
as $$
begin
  return p::date;
exception when others then
  return null;
end;
$$;

-- ── Alvos por régua ─────────────────────────────────────────────────────────
-- relationship_targets recebia o tipo, e o tipo identificava a régua. Com
-- várias réguas 'data' por empresa isso deixou de valer: agora a função
-- recebe a régua.
drop function if exists public.relationship_targets(uuid, text, int);

create or replace function public.relationship_rule_targets(
  p_rule_id uuid,
  p_limit int default 200
)
returns table (contact_id uuid, name text, phone text, field_value text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule record;
  v_tz text;
  v_today date;
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

  return query
  select
    c.id,
    c.name,
    c.phone,
    case when v_rule.kind = 'data' then c.fields ->> v_rule.field_key else null end
  from public.contacts c
  where c.company_id = v_rule.company_id
    and c.phone is not null
    and length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
    -- Cooldown: as fixas contam por tipo (uma por empresa); as por data contam
    -- pela própria régua, senão "30 dias antes" bloquearia "7 dias antes".
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
        and public.try_date(c.fields ->> v_rule.field_key) is not null
        -- Janela de 3 dias: se a volta de ontem caiu fora do horário, a de
        -- hoje ainda alcança. O cooldown impede a repetição dentro da janela.
        and (public.try_date(c.fields ->> v_rule.field_key) + v_rule.offset_days)
            between (v_today - 2) and v_today
      else false
    end
  order by c.last_interaction_at nulls last
  limit p_limit;
end;
$$;

-- ── Réguas sugeridas por nicho ──────────────────────────────────────────────
-- Entram desligadas, com a mensagem pronta: a empresa lê, ajusta e liga.
create table public.niche_rules (
  niche_key text not null references public.niches(key) on delete cascade,
  field_key text not null,
  offset_days int not null,
  title text not null,
  message text not null,
  cooldown_days int not null default 30,
  primary key (niche_key, field_key, offset_days)
);

alter table public.niche_rules enable row level security;
create policy "todos leem niche_rules" on public.niche_rules for select using (true);
create policy "super admin edita niche_rules" on public.niche_rules for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.seed_niche_rules(p_company_id uuid)
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

  insert into public.relationship_rules
    (company_id, kind, enabled, title, field_key, offset_days, message, cooldown_days)
  select p_company_id, 'data', false, nr.title, nr.field_key, nr.offset_days, nr.message, nr.cooldown_days
  from public.niche_rules nr
  where nr.niche_key = v_niche
  on conflict (company_id, field_key, offset_days) where kind = 'data' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Só apply_niche_template (e esta migration) chamam; ninguém do app.
revoke all on function public.seed_niche_rules(uuid) from public;

-- apply_niche_template passa a trazer também as réguas.
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
begin
  if not public.is_super_admin() then
    raise exception 'Somente o super admin aplica modelos de nicho';
  end if;

  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return jsonb_build_object('stages', 0, 'removed', 0, 'fields', 0, 'kinds', 0, 'rules', 0);
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

  v_rules := public.seed_niche_rules(p_company_id);

  return jsonb_build_object(
    'stages', v_stages,
    'removed', v_removed,
    'fields', v_fields,
    'kinds', v_kinds,
    'rules', v_rules
  );
end;
$$;

-- ── Modelos ─────────────────────────────────────────────────────────────────
-- {{data}} vira a data do campo (dd/mm/aaaa); {{dias}} vira o deslocamento
-- sem sinal. {{nome}} e {{primeiro_nome}} como nas outras réguas.
insert into public.niche_rules (niche_key, field_key, offset_days, title, message, cooldown_days) values
  ('buffet', 'data_evento', -7, 'Semana do evento',
   'Oi {{primeiro_nome}}! Falta uma semana para o seu evento, dia {{data}}. Vamos confirmar os últimos detalhes? Qualquer ajuste no cardápio ou no número de convidados, é só me dizer.', 30),
  ('buffet', 'data_evento', 3, 'Pós-evento',
   'Oi {{primeiro_nome}}! Como foi a festa? Adoraríamos saber o que você achou — e se puder, uma indicação para quem está planejando a próxima faz toda a diferença para nós. 🙏', 30),

  ('corretora', 'vencimento', -30, 'Renovação em 30 dias',
   'Oi {{primeiro_nome}}! Sua apólice vence em {{data}}. Já estou cotando a renovação para você não ficar descoberto — posso te mandar as opções esta semana?', 20),
  ('corretora', 'vencimento', -7, 'Renovação em 7 dias',
   '{{primeiro_nome}}, faltam 7 dias para a sua apólice vencer ({{data}}). Me confirma se seguimos com a renovação para eu emitir a tempo?', 20),

  ('estetica', 'proximo_retorno', -3, 'Lembrete de retorno',
   'Oi {{primeiro_nome}}! Seu retorno está previsto para {{data}}. Quer confirmar o horário ou prefere remarcar?', 30),

  ('alimentacao', 'ultimo_pedido', 10, 'Sentimos sua falta',
   'Oi {{primeiro_nome}}! Faz uns dias que você não pede com a gente 😊 Quer ver o cardápio de hoje?', 15),

  ('administradora', 'vencimento_boleto', -3, 'Boleto vence em 3 dias',
   'Oi {{primeiro_nome}}! Seu boleto vence em {{data}}. Se precisar da 2ª via, é só responder aqui.', 20),
  ('administradora', 'vencimento_boleto', 1, 'Boleto vencido',
   '{{primeiro_nome}}, o boleto com vencimento em {{data}} consta em aberto. Se já pagou, desconsidere; se precisar da 2ª via atualizada, é só pedir.', 20)
on conflict do nothing;

-- Empresas que já escolheram o nicho recebem as réguas sugeridas agora.
select public.seed_niche_rules(id) from public.companies where niche_key is not null;

notify pgrst, 'reload schema';
