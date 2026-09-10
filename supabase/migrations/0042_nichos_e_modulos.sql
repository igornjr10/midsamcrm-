-- Nichos e módulos: o mesmo CRM vendido em pacotes diferentes.
--
-- O produto já é multitenant desde a 0007 — o que faltava é cada empresa ver um
-- recorte diferente dele. Um buffet não precisa de Disparos; uma corretora não
-- usa Biblioteca de cardápio.
--
-- Duas camadas, de propósito:
--
--   nicho    -> o pacote padrão ("Buffet vem com Agenda e Biblioteca")
--   exceção  -> o que aquele cliente comprou a mais ou a menos
--
-- Sem a segunda, todo cliente que pede um módulo fora do pacote viraria um
-- nicho novo, e em seis meses existiriam vinte nichos com um cliente cada.
--
-- Módulo core não entra na conta: Pipeline, Contatos e Chat são o produto. Ter
-- como desligá-los seria ter como vender um CRM que não abre conversa.

-- ── Catálogos ───────────────────────────────────────────────────────────────
create table public.niches (
  key text primary key,
  name text not null,
  description text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.features (
  key text primary key,
  label text not null,
  description text,
  /** Rota do menu, para o front ligar módulo e navegação sem uma segunda lista. */
  route text,
  /** Core não pode ser desligado por ninguém. */
  core boolean not null default false,
  position int not null default 0
);

create table public.niche_features (
  niche_key text not null references public.niches(key) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  primary key (niche_key, feature_key)
);

-- ── A empresa e suas exceções ───────────────────────────────────────────────
alter table public.companies
  add column if not exists niche_key text references public.niches(key) on delete set null;

comment on column public.companies.niche_key is
  'Nicho da empresa. Null = sem nicho definido; nesse caso todos os módulos ficam ligados.';

create table public.company_features (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  /** true = liberado fora do pacote; false = removido do pacote. */
  enabled boolean not null,
  created_at timestamptz not null default now(),
  primary key (company_id, feature_key)
);

-- ── Quem lê e quem escreve ──────────────────────────────────────────────────
-- Os catálogos são lidos por qualquer usuário autenticado: sem eles o menu não
-- se desenha. Escrever é só do super admin — é a régua comercial do produto.
alter table public.niches enable row level security;
alter table public.features enable row level security;
alter table public.niche_features enable row level security;
alter table public.company_features enable row level security;

create policy "todos leem nichos" on public.niches for select using (true);
create policy "super admin edita nichos" on public.niches for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "todos leem features" on public.features for select using (true);
create policy "super admin edita features" on public.features for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "todos leem niche_features" on public.niche_features for select using (true);
create policy "super admin edita niche_features" on public.niche_features for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- A empresa enxerga as próprias exceções (o front precisa para montar o menu),
-- mas quem concede é o super admin.
create policy "empresa le as proprias excecoes" on public.company_features for select
  using (company_id in (select public.my_company_ids()) or public.is_super_admin());
create policy "super admin edita excecoes" on public.company_features for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Resolução ───────────────────────────────────────────────────────────────
/**
 * Os módulos de uma empresa, já resolvidos.
 *
 * A ordem é: core sempre liga; exceção do cliente manda sobre o pacote; sem
 * exceção vale o nicho; sem nicho, tudo ligado.
 *
 * Esse último caso é o que mantém as empresas que já existem funcionando: elas
 * nasceram antes desta migration e não têm nicho nenhum.
 */
create or replace function public.company_feature_set(p_company_id uuid)
returns table (feature_key text, label text, route text, core boolean, enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.key,
    f.label,
    f.route,
    f.core,
    case
      when f.core then true
      when cf.enabled is not null then cf.enabled
      when c.niche_key is null then true
      else nf.feature_key is not null
    end as enabled
  from public.features f
  cross join (select niche_key from public.companies where id = p_company_id) c
  left join public.company_features cf
    on cf.company_id = p_company_id and cf.feature_key = f.key
  left join public.niche_features nf
    on nf.niche_key = c.niche_key and nf.feature_key = f.key
  where
    p_company_id in (select public.my_company_ids())
    or public.is_super_admin()
  order by f.position, f.label;
$$;

grant execute on function public.company_feature_set(uuid) to authenticated;

-- ── Semente ─────────────────────────────────────────────────────────────────
insert into public.features (key, label, description, route, core, position) values
  ('pipeline',   'Pipeline',    'Funil de vendas por etapas',                  '/',              true,  10),
  ('contatos',   'Contatos',    'Base de contatos e segmentos',                '/contatos',      true,  20),
  ('chat',       'Chat',        'Atendimento por WhatsApp',                    '/chat',          true,  30),
  ('agenda',     'Agenda',      'Compromissos e integração com Google Agenda', '/agenda',        false, 40),
  ('disparos',   'Disparos',    'Campanhas em massa para a base',              '/disparos',      false, 50),
  ('sdr',        'SDR IA',      'Atendimento e follow-up automáticos',         '/sdr',           false, 60),
  ('biblioteca', 'Biblioteca',  'Arquivos que a equipe e a IA enviam',         '/biblioteca',    false, 70);

insert into public.niches (key, name, description, position) values
  ('buffet',        'Buffet e Eventos',    'Festas, casamentos, formaturas',            10),
  ('corretora',     'Corretora',           'Seguros, consórcios, planos',               20),
  ('estetica',      'Estética e Saúde',    'Clínicas, salões, procedimentos',           30),
  ('alimentacao',   'Alimentação',         'Restaurantes, delivery, marmitas',          40),
  ('administradora','Administradora',      'Condomínios, imóveis, gestão',              50),
  ('geral',         'Geral',               'Sem recorte de nicho — tudo liberado',      99);

-- Todo nicho nasce com todos os módulos. Desmarcar é decisão comercial, feita
-- na tela de Empresas; a migration não tem opinião sobre o que cada um vende.
insert into public.niche_features (niche_key, feature_key)
select n.key, f.key from public.niches n cross join public.features f;

notify pgrst, 'reload schema';
