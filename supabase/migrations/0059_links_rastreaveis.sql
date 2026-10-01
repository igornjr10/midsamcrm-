-- Links rastreáveis: a mensagem pronta do link (wa.me) leva um código entre
-- colchetes, ex. "Olá! Vi o anúncio [A1]". Quando o lead novo manda essa
-- primeira mensagem, o webhook acha o código aqui e grava a origem do contato.
--
-- Serve onde o WhatsApp não anexa o cartão do anúncio: link na bio, no site,
-- em anúncio que leva ao Instagram, QR code impresso...
create table if not exists public.lead_source_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Só letras, números, _ e -: é o que o webhook procura entre colchetes.
  code text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  -- Chave de LEAD_SOURCES no front (anuncio, instagram, site...).
  source text not null default 'anuncio',
  -- O que vira o detalhe da origem: nome da campanha, do anúncio, do local.
  label text not null,
  -- Texto da mensagem pronta, sem o código (o código vai no fim).
  message text not null default 'Olá! Quero saber mais',
  created_at timestamptz not null default now()
);

create unique index if not exists lead_source_codes_company_code
  on public.lead_source_codes (company_id, upper(code));

alter table public.lead_source_codes enable row level security;

create policy "company lead source codes" on public.lead_source_codes for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());
