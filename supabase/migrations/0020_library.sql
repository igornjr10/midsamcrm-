-- Biblioteca de arquivos da empresa: cardápio, orçamentos e material de apoio.
--
-- Existe para o material sair do celular de quem atende e ficar num lugar só —
-- e para a IA poder enviar sozinha o que o lead pediu, sem alguém garimpar o
-- PDF certo na galeria.
--
-- O arquivo vive no bucket 'library' (público, como o chat-media): o envio pelo
-- WhatsApp baixa a URL e sobe o binário para a Meta, então a URL precisa ser
-- alcançável sem token.

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'cardapio' e 'orcamento' são as duas abas; 'outro' evita ter que migrar a
  -- tabela para o primeiro arquivo que não couber nas duas.
  kind text not null check (kind in ('cardapio', 'orcamento', 'outro')),
  title text not null,
  -- Serve à IA: é por aqui que ela decide qual arquivo responde o pedido do
  -- lead ("cardápio de festa", "orçamento do buffet 50 pessoas").
  description text,
  file_path text not null,
  file_url text not null,
  mimetype text not null,
  media_type text not null check (media_type in ('image', 'document', 'video')),
  size_bytes bigint,
  -- Desligar sem apagar: material fora de validade sai do alcance da IA mas
  -- continua no histórico de quem já recebeu.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_library_company_kind on public.library_items(company_id, kind, created_at desc);

alter table public.library_items enable row level security;

create policy "company library" on public.library_items for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_library_items_updated_at
  before update on public.library_items
  for each row execute function public.update_updated_at_column();

-- ── Bucket ──────────────────────────────────────────────────────────────────
-- Caminho: {company_id}/{uuid}.{ext}
insert into storage.buckets (id, name, public)
values ('library', 'library', true)
on conflict (id) do nothing;

-- Escrita por membro da empresa dona da pasta. Diferente do chat-media, que usa
-- a pasta do usuário: aqui o material é da empresa, e quem atende muda.
create policy "library company write"
  on storage.objects for insert
  with check (
    bucket_id = 'library'
    and exists (
      select 1 from public.company_members m
      where m.user_id = auth.uid()
        and m.company_id::text = (storage.foldername(name))[1]
    )
  );

create policy "library company delete"
  on storage.objects for delete
  using (
    bucket_id = 'library'
    and exists (
      select 1 from public.company_members m
      where m.user_id = auth.uid()
        and m.company_id::text = (storage.foldername(name))[1]
    )
  );

create policy "library public read"
  on storage.objects for select
  using (bucket_id = 'library');

-- ── Consulta usada pela IA ──────────────────────────────────────────────────
-- security definer porque o runner (service_role) chama por company_id; devolve
-- só o que está ativo e o mínimo que o modelo precisa para escolher.
create or replace function public.library_for_ai(p_company_id uuid)
returns table (id uuid, kind text, title text, description text)
language sql
stable
security definer
set search_path = public
as $$
  select id, kind, title, description
  from public.library_items
  where company_id = p_company_id and active
  order by kind, created_at desc
  limit 50;
$$;

grant execute on function public.library_for_ai(uuid) to service_role;
