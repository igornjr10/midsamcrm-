-- Etiquetas no contato e respostas rápidas no chat.
--
-- Etiqueta é o recorte que não cabe em etapa nem em campo: VIP, Atacado,
-- Sinistro, Reclamou. Serve de filtro em Contatos e Disparos, aparece na
-- lista do Chat e a IA pode aplicar — uma etiqueta marcada como "escala"
-- chama humano na hora (é o "sinistro fura a fila" da corretora).
--
-- Resposta rápida é o texto que a equipe digita dez vezes por dia: horário,
-- endereço, formas de pagamento. "/" no chat abre a lista. A IA também lê
-- essas respostas como a informação oficial da empresa.

-- ── Etiquetas ───────────────────────────────────────────────────────────────
-- Nomes no array, não ids: é o que filtra, o que a IA enxerga e o que o
-- disparo usa. Renomear e excluir propagam por trigger logo abaixo.
alter table public.contacts
  add column if not exists tags text[] not null default '{}';

create index if not exists idx_contacts_tags on public.contacts using gin (tags);

create table public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  tone text not null default 'slate'
    check (tone in ('slate', 'sky', 'indigo', 'violet', 'teal', 'amber', 'emerald', 'rose')),
  /** Aplicada pela IA, pausa a conversa e chama uma pessoa. */
  escalate boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

alter table public.contact_tags enable row level security;

create policy "company contact tags" on public.contact_tags for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create or replace function public.propagate_contact_tag_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.contacts
    set tags = array_remove(tags, old.name)
    where company_id = old.company_id and old.name = any(tags);
    return old;
  end if;
  if new.name <> old.name then
    update public.contacts
    set tags = array_replace(tags, old.name, new.name)
    where company_id = old.company_id and old.name = any(tags);
  end if;
  return new;
end;
$$;

create trigger propagate_contact_tag_change
  after update of name or delete on public.contact_tags
  for each row execute function public.propagate_contact_tag_change();

-- ── Respostas rápidas ───────────────────────────────────────────────────────
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  /** O que se digita depois da barra: /horario. */
  shortcut text not null,
  title text not null,
  /** Aceita {{nome}} e {{primeiro_nome}}. */
  content text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, shortcut)
);

alter table public.quick_replies enable row level security;

create policy "company quick replies" on public.quick_replies for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_quick_replies_updated_at
  before update on public.quick_replies
  for each row execute function public.update_updated_at_column();

-- ── Modelos por nicho ───────────────────────────────────────────────────────
create table public.niche_tags (
  niche_key text not null references public.niches(key) on delete cascade,
  name text not null,
  tone text not null default 'slate',
  escalate boolean not null default false,
  position int not null default 0,
  primary key (niche_key, name)
);

create table public.niche_quick_replies (
  niche_key text not null references public.niches(key) on delete cascade,
  shortcut text not null,
  title text not null,
  content text not null,
  position int not null default 0,
  primary key (niche_key, shortcut)
);

alter table public.niche_tags enable row level security;
alter table public.niche_quick_replies enable row level security;

create policy "todos leem niche_tags" on public.niche_tags for select using (true);
create policy "super admin edita niche_tags" on public.niche_tags for all
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "todos leem niche_quick_replies" on public.niche_quick_replies for select using (true);
create policy "super admin edita niche_quick_replies" on public.niche_quick_replies for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.seed_niche_tags_and_replies(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_niche text;
  v_tags int := 0;
  v_replies int := 0;
begin
  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return jsonb_build_object('tags', 0, 'replies', 0);
  end if;

  insert into public.contact_tags (company_id, name, tone, escalate, position)
  select p_company_id, nt.name, nt.tone, nt.escalate, nt.position
  from public.niche_tags nt
  where nt.niche_key = v_niche
  on conflict (company_id, name) do nothing;
  get diagnostics v_tags = row_count;

  insert into public.quick_replies (company_id, shortcut, title, content, position)
  select p_company_id, nq.shortcut, nq.title, nq.content, nq.position
  from public.niche_quick_replies nq
  where nq.niche_key = v_niche
  on conflict (company_id, shortcut) do nothing;
  get diagnostics v_replies = row_count;

  return jsonb_build_object('tags', v_tags, 'replies', v_replies);
end;
$$;

revoke all on function public.seed_niche_tags_and_replies(uuid) from public;

-- apply_niche_template passa a trazer etiquetas e respostas.
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
  v_extra jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Somente o super admin aplica modelos de nicho';
  end if;

  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return jsonb_build_object(
      'stages', 0, 'removed', 0, 'fields', 0, 'kinds', 0, 'rules', 0, 'tags', 0, 'replies', 0
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

  v_rules := public.seed_niche_rules(p_company_id);
  v_extra := public.seed_niche_tags_and_replies(p_company_id);

  return jsonb_build_object(
    'stages', v_stages,
    'removed', v_removed,
    'fields', v_fields,
    'kinds', v_kinds,
    'rules', v_rules,
    'tags', v_extra -> 'tags',
    'replies', v_extra -> 'replies'
  );
end;
$$;

-- ── Semente ─────────────────────────────────────────────────────────────────
insert into public.niche_tags (niche_key, name, tone, escalate, position) values
  ('buffet',         'VIP',          'violet',  false, 1),
  ('buffet',         'Indicação',    'teal',    false, 2),
  ('moda',           'VIP',          'violet',  false, 1),
  ('moda',           'Atacado',      'teal',    false, 2),
  ('corretora',      'Sinistro',     'rose',    true,  1),
  ('corretora',      'Renovação',    'amber',   false, 2),
  ('corretora',      'VIP',          'violet',  false, 3),
  ('estetica',       'Pacote',       'teal',    false, 1),
  ('estetica',       'VIP',          'violet',  false, 2),
  ('alimentacao',    'Recorrente',   'teal',    false, 1),
  ('alimentacao',    'Reclamou',     'rose',    true,  2),
  ('administradora', 'Financeiro',   'amber',   false, 1),
  ('administradora', 'Manutenção',   'sky',     false, 2),
  ('administradora', 'Urgente',      'rose',    true,  3)
on conflict do nothing;

-- As três respostas que toda empresa digita todo dia, com texto para editar.
insert into public.niche_quick_replies (niche_key, shortcut, title, content, position)
select n.key, r.shortcut, r.title, r.content, r.position
from public.niches n
cross join (values
  ('horario',   'Horário de atendimento', 'Oi {{primeiro_nome}}! Nosso horário é de segunda a sexta, das 9h às 18h, e sábado das 9h às 13h.', 1),
  ('endereco',  'Endereço',               'Estamos na Rua Exemplo, 123 — Centro. Tem estacionamento na porta.', 2),
  ('pagamento', 'Formas de pagamento',    'Aceitamos Pix, cartão de crédito em até 3x sem juros e débito.', 3)
) as r(shortcut, title, content, position)
on conflict do nothing;

-- Empresas que já têm nicho recebem etiquetas e respostas agora.
select public.seed_niche_tags_and_replies(id) from public.companies where niche_key is not null;

notify pgrst, 'reload schema';
