-- Campos personalizados no contato e modelos por nicho.
--
-- A 0042 fez o nicho escolher quais módulos a empresa vê. Mas dentro de cada
-- módulo tudo continuava igual: o buffet não tinha onde anotar a data da festa,
-- a corretora não tinha o vencimento da apólice, e o funil nascia com as mesmas
-- seis etapas para todo mundo.
--
-- Três coisas aqui:
--
--   contact_fields     -> campos extras do contato, definidos por empresa
--   appointment_kinds  -> tipos de compromisso extras, por empresa
--   niche_*            -> o modelo de cada nicho: etapas, campos e tipos que
--                         entram na empresa quando o super admin escolhe o nicho
--
-- O modelo é aditivo. Aplicar duas vezes não duplica nada, e etapa com contato
-- dentro nunca é removida. A única remoção é das etapas padrão vazias
-- (Contatado, Proposta, Negociação) quando o nicho traz as suas — senão a
-- empresa nova ficaria com dois funis emendados.

-- ── Valores no contato ──────────────────────────────────────────────────────
-- jsonb em vez de tabela de valores: o contato já é carregado inteiro em toda
-- tela, e o campo chega junto sem uma segunda consulta. Chave = contact_fields.key.
alter table public.contacts
  add column if not exists fields jsonb not null default '{}'::jsonb;

comment on column public.contacts.fields is
  'Valores dos campos personalizados, indexados pela chave de contact_fields. Data em YYYY-MM-DD, número como número.';

-- ── Definições por empresa ──────────────────────────────────────────────────
create table public.contact_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  /** Chave gravada em contacts.fields. Imutável depois de criada. */
  key text not null,
  label text not null,
  type text not null default 'text' check (type in ('text', 'number', 'date', 'select')),
  /** Só para type = 'select'. */
  options text[] not null default '{}',
  /** Aparece no card do Pipeline e no painel do Chat. */
  show_on_card boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create index idx_contact_fields_company on public.contact_fields(company_id, position);

alter table public.contact_fields enable row level security;

create policy "company contact fields" on public.contact_fields for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_contact_fields_updated_at
  before update on public.contact_fields
  for each row execute function public.update_updated_at_column();

-- ── Tipos de compromisso por empresa ────────────────────────────────────────
-- Os cinco tipos originais (meeting, call, visit, followup, other) continuam
-- no front. A check constraint sai para os tipos do nicho caberem na coluna.
alter table public.appointments drop constraint if exists appointments_kind_check;

create table public.appointment_kinds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  label text not null,
  tone text not null default 'slate'
    check (tone in ('slate', 'sky', 'indigo', 'violet', 'teal', 'amber', 'emerald', 'rose')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

alter table public.appointment_kinds enable row level security;

create policy "company appointment kinds" on public.appointment_kinds for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- ── Modelos por nicho (catálogo) ────────────────────────────────────────────
create table public.niche_stages (
  niche_key text not null references public.niches(key) on delete cascade,
  key text not null,
  name text not null,
  tone text not null default 'slate',
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  position int not null default 0,
  primary key (niche_key, key)
);

create table public.niche_fields (
  niche_key text not null references public.niches(key) on delete cascade,
  key text not null,
  label text not null,
  type text not null default 'text' check (type in ('text', 'number', 'date', 'select')),
  options text[] not null default '{}',
  show_on_card boolean not null default false,
  position int not null default 0,
  primary key (niche_key, key)
);

create table public.niche_appointment_kinds (
  niche_key text not null references public.niches(key) on delete cascade,
  key text not null,
  label text not null,
  tone text not null default 'slate',
  position int not null default 0,
  primary key (niche_key, key)
);

alter table public.niche_stages enable row level security;
alter table public.niche_fields enable row level security;
alter table public.niche_appointment_kinds enable row level security;

create policy "todos leem niche_stages" on public.niche_stages for select using (true);
create policy "super admin edita niche_stages" on public.niche_stages for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "todos leem niche_fields" on public.niche_fields for select using (true);
create policy "super admin edita niche_fields" on public.niche_fields for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "todos leem niche_appointment_kinds" on public.niche_appointment_kinds for select using (true);
create policy "super admin edita niche_appointment_kinds" on public.niche_appointment_kinds for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Aplicar o modelo ────────────────────────────────────────────────────────
/**
 * Leva para a empresa o que o nicho dela define. Devolve quantos itens de cada
 * tipo entraram, para a tela dizer o que aconteceu.
 *
 * Só o super admin chama: é ele quem escolhe o nicho na tela de Empresas.
 */
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
begin
  if not public.is_super_admin() then
    raise exception 'Somente o super admin aplica modelos de nicho';
  end if;

  select niche_key into v_niche from public.companies where id = p_company_id;
  if v_niche is null then
    return jsonb_build_object('stages', 0, 'removed', 0, 'fields', 0, 'kinds', 0);
  end if;

  -- Etapas do nicho entram depois das etapas abertas que já existem; Ganho e
  -- Perdido são empurrados para o fim logo abaixo.
  select coalesce(max(position), 0) into v_open_max
  from public.pipeline_stages
  where company_id = p_company_id and kind = 'open';

  insert into public.pipeline_stages (company_id, key, name, tone, kind, position)
  select p_company_id, ns.key, ns.name, ns.tone, ns.kind, v_open_max + ns.position
  from public.niche_stages ns
  where ns.niche_key = v_niche
  on conflict (company_id, key) do nothing;
  get diagnostics v_stages = row_count;

  -- As etapas genéricas do seed só saem se o nicho trouxe etapa nova, se
  -- estiverem vazias e se o próprio nicho não as usa. 'new' fica sempre: é
  -- onde o contato que chega pelo WhatsApp nasce.
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

  -- Renumera: abertas na ordem em que estavam, depois Ganho, depois Perdido.
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

  return jsonb_build_object(
    'stages', v_stages,
    'removed', v_removed,
    'fields', v_fields,
    'kinds', v_kinds
  );
end;
$$;

grant execute on function public.apply_niche_template(uuid) to authenticated;

-- ── Modelos ─────────────────────────────────────────────────────────────────
-- Etapas: só as abertas, entre "Novo" e o desfecho. Ganho e Perdido já existem.
insert into public.niche_stages (niche_key, key, name, tone, position) values
  ('buffet',         'orcamento-enviado', 'Orçamento enviado',     'sky',    1),
  ('buffet',         'degustacao',        'Visita ou degustação',  'violet', 2),
  ('buffet',         'proposta',          'Proposta',              'indigo', 3),
  ('buffet',         'sinal-pago',        'Sinal pago',            'teal',   4),

  ('moda',           'interessado',       'Interessado',           'sky',    1),
  ('moda',           'reservado',         'Reservado',             'indigo', 2),
  ('moda',           'separado',          'Pedido separado',       'violet', 3),
  ('moda',           'enviado',           'Enviado',               'teal',   4),

  ('corretora',      'cotacao',           'Cotação',               'sky',    1),
  ('corretora',      'documentos',        'Documentos',            'indigo', 2),
  ('corretora',      'proposta',          'Proposta',              'violet', 3),
  ('corretora',      'emissao',           'Em emissão',            'teal',   4),
  ('corretora',      'renovacao',         'Renovação',             'amber',  5),

  ('estetica',       'avaliacao',         'Avaliação agendada',    'sky',    1),
  ('estetica',       'orcamento',         'Orçamento',             'indigo', 2),
  ('estetica',       'em-tratamento',     'Em tratamento',         'violet', 3),
  ('estetica',       'retorno',           'Retorno',               'teal',   4),

  ('alimentacao',    'primeiro-pedido',   'Primeiro pedido',       'sky',    1),
  ('alimentacao',    'recorrente',        'Recorrente',            'teal',   2),
  ('alimentacao',    'esfriando',         'Esfriando',             'amber',  3),

  ('administradora', 'solicitacao',       'Solicitação',           'sky',    1),
  ('administradora', 'em-atendimento',    'Em atendimento',        'indigo', 2),
  ('administradora', 'aguardando-morador','Aguardando morador',    'amber',  3)
on conflict do nothing;

insert into public.niche_fields (niche_key, key, label, type, options, show_on_card, position) values
  ('buffet',         'data_evento',       'Data do evento',        'date',   '{}', true,  1),
  ('buffet',         'convidados',        'Convidados',            'number', '{}', true,  2),
  ('buffet',         'tipo_evento',       'Tipo de evento',        'select', array['Casamento', 'Aniversário', 'Formatura', 'Corporativo', 'Outro'], false, 3),
  ('buffet',         'local_evento',      'Local do evento',       'text',   '{}', false, 4),

  ('moda',           'numeracao',         'Numeração',             'text',   '{}', true,  1),
  ('moda',           'interesse',         'Interesse',             'select', array['Feminino', 'Masculino', 'Infantil'], true, 2),
  ('moda',           'preferencias',      'Preferências',          'text',   '{}', false, 3),

  ('corretora',      'tipo_seguro',       'Tipo de seguro',        'select', array['Auto', 'Vida', 'Saúde', 'Residencial', 'Consórcio', 'Outro'], true, 1),
  ('corretora',      'seguradora',        'Seguradora',            'text',   '{}', false, 2),
  ('corretora',      'vencimento',        'Vencimento da apólice', 'date',   '{}', true,  3),
  ('corretora',      'premio',            'Prêmio (R$)',           'number', '{}', false, 4),

  ('estetica',       'procedimento',      'Procedimento',          'text',   '{}', true,  1),
  ('estetica',       'profissional',      'Profissional',          'text',   '{}', false, 2),
  ('estetica',       'proximo_retorno',   'Próximo retorno',       'date',   '{}', true,  3),
  ('estetica',       'sessoes_restantes', 'Sessões restantes',     'number', '{}', true,  4),

  ('alimentacao',    'bairro',            'Bairro',                'text',   '{}', true,  1),
  ('alimentacao',    'pedido_favorito',   'Pedido favorito',       'text',   '{}', false, 2),
  ('alimentacao',    'ultimo_pedido',     'Último pedido',         'date',   '{}', true,  3),

  ('administradora', 'condominio',        'Condomínio',            'text',   '{}', true,  1),
  ('administradora', 'unidade',           'Unidade',               'text',   '{}', true,  2),
  ('administradora', 'perfil',            'Perfil',                'select', array['Morador', 'Inquilino', 'Proprietário', 'Síndico'], false, 3),
  ('administradora', 'vencimento_boleto', 'Vencimento do boleto',  'date',   '{}', false, 4)
on conflict do nothing;

insert into public.niche_appointment_kinds (niche_key, key, label, tone, position) values
  ('buffet',         'degustacao',   'Degustação',   'violet',  1),
  ('buffet',         'evento',       'Evento',       'emerald', 2),
  ('corretora',      'vistoria',     'Vistoria',     'teal',    1),
  ('estetica',       'consulta',     'Consulta',     'sky',     1),
  ('estetica',       'procedimento', 'Procedimento', 'violet',  2),
  ('estetica',       'retorno',      'Retorno',      'teal',    3),
  ('administradora', 'assembleia',   'Assembleia',   'indigo',  1),
  ('administradora', 'vistoria',     'Vistoria',     'teal',    2)
on conflict do nothing;

notify pgrst, 'reload schema';
