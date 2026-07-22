-- Config WhatsApp (Datafy/Cloud API) — uma por usuario.
-- phone_number_id e unico globalmente: e a chave de roteamento do webhook
-- (todas as contas apontam o webhook do Datafy para a mesma URL fixa
--  /functions/v1/whatsapp-webhook; o payload identifica a conta pelo
--  metadata.phone_number_id).

create table public.whatsapp_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  phone_number_id text not null,
  waba_id text not null,
  access_token text not null,
  webhook_verify_token text not null default encode(gen_random_bytes(12), 'hex'),
  app_id text,
  active boolean not null default true,
  label text,
  phone_number text,
  api_base_url text not null default 'https://cloud.datafyapi.com.br/v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index whatsapp_configs_phone_number_id_uniq
  on public.whatsapp_configs(phone_number_id);

alter table public.whatsapp_configs enable row level security;

create policy "own whatsapp config" on public.whatsapp_configs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger update_whatsapp_configs_updated_at
  before update on public.whatsapp_configs
  for each row execute function public.update_updated_at_column();
