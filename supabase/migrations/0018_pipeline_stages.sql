-- Funil configurável por empresa.
--
-- As etapas eram uma constante no front (PIPELINE_STAGES), então renomear uma
-- etapa ou criar outra exigia deploy — e todas as empresas ficavam com o mesmo
-- funil. Agora cada empresa tem as suas.
--
-- contacts.stage continua guardando o texto da chave ('new', 'won', ...), sem
-- FK nem uuid: os dados já gravados seguem válidos e a coluna não é reescrita.
-- A chave é imutável depois de criada; o que o usuário edita é o `name`.

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  name text not null,
  tone text not null default 'slate'
    check (tone in ('slate', 'sky', 'indigo', 'violet', 'teal', 'amber', 'emerald', 'rose')),
  -- 'won'/'lost' fecham o negócio: o Pipeline pede motivo ao soltar em 'lost'.
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create index idx_pipeline_stages_company on public.pipeline_stages(company_id, position);

alter table public.pipeline_stages enable row level security;

create policy "company pipeline stages" on public.pipeline_stages for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_pipeline_stages_updated_at
  before update on public.pipeline_stages
  for each row execute function public.update_updated_at_column();

-- Funil padrão: as mesmas seis etapas que estavam no front, com as chaves que
-- os contatos já usam.
create or replace function public.seed_default_pipeline_stages(p_company_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pipeline_stages (company_id, key, name, tone, kind, position)
  values
    (p_company_id, 'new',         'Novo',       'slate',   'open', 1),
    (p_company_id, 'contacted',   'Contatado',  'sky',     'open', 2),
    (p_company_id, 'proposal',    'Proposta',   'indigo',  'open', 3),
    (p_company_id, 'negotiation', 'Negociação', 'amber',   'open', 4),
    (p_company_id, 'won',         'Ganho',      'emerald', 'won',  5),
    (p_company_id, 'lost',        'Perdido',    'rose',    'lost', 6)
  on conflict (company_id, key) do nothing;
$$;

-- Empresas que já existem.
select public.seed_default_pipeline_stages(id) from public.companies;

-- Empresas novas: tanto o signup quanto o painel de Empresas passam por aqui.
create or replace function public.handle_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_pipeline_stages(new.id);
  return new;
end;
$$;

create trigger seed_pipeline_stages_on_company
  after insert on public.companies
  for each row execute function public.handle_new_company();
