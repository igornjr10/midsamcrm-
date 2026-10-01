-- De onde o lead veio. Preenchido sozinho na entrada (WhatsApp, anúncio,
-- formulário de captação, prospecção, cadastro manual) e editável na ficha.
--
-- Texto livre de propósito, sem check: as chaves conhecidas vivem no front
-- (LEAD_SOURCES), e uma origem nova não pode exigir migration.
alter table public.contacts
  add column if not exists source text,
  add column if not exists source_detail text;

comment on column public.contacts.source is
  'Origem do lead: whatsapp, anuncio, captacao, prospeccao, manual, indicacao, instagram, site, evento, outro';
comment on column public.contacts.source_detail is
  'Detalhe da origem: título do anúncio, nome do formulário, quem indicou...';
