-- WhatsApp por provedor: Meta/Datafy (o que já existe) e Evolution API.
--
-- Cada empresa continua com uma config só (whatsapp_configs_company_uniq); o
-- que muda é de quem ela fala. `provider` diz qual adapter usar, e as colunas
-- de cada provedor convivem na mesma linha — não vale a pena uma tabela por
-- provedor para 3 ou 4 campos que nunca são consultados juntos.
--
-- As colunas da Meta viram nullable: uma linha do Evolution não tem
-- phone_number_id nem WABA. A integridade passa a ser por provider, no check
-- lá embaixo.

alter table public.whatsapp_configs
  add column if not exists provider text not null default 'meta',
  -- Nome legível da instância no painel do Evolution. Só para exibir: nomes se
  -- repetem e mudam de caixa, então nada de roteamento depende deles.
  add column if not exists instance_name text,
  add column if not exists instance_id text,
  -- Token próprio da instância. É a chave de roteamento do webhook: o Evolution
  -- v2 manda `apikey` em todo evento, e ele é único por instância — ao
  -- contrário do nome, que a listagem do servidor mostra duplicado.
  add column if not exists instance_token text;

alter table public.whatsapp_configs
  drop constraint if exists whatsapp_configs_provider_check;
alter table public.whatsapp_configs
  add constraint whatsapp_configs_provider_check
  check (provider in ('meta', 'evolution', 'uazapi'));

alter table public.whatsapp_configs
  alter column phone_number_id drop not null,
  alter column waba_id drop not null,
  alter column access_token drop not null;

-- Roteamento do webhook, um índice por provedor. Ambos parciais: várias linhas
-- podem ter o campo do outro provedor nulo sem colidir.
create unique index if not exists whatsapp_configs_instance_token_uniq
  on public.whatsapp_configs(instance_token)
  where instance_token is not null;

-- Cada provedor exige o seu mínimo. Sem isso uma linha do Evolution salva sem
-- token passaria batido e o webhook nunca acharia a empresa dela.
alter table public.whatsapp_configs
  drop constraint if exists whatsapp_configs_provider_fields;
alter table public.whatsapp_configs
  add constraint whatsapp_configs_provider_fields check (
    case provider
      when 'meta' then phone_number_id is not null and access_token is not null
      else instance_name is not null and api_base_url is not null
    end
  );

comment on column public.whatsapp_configs.provider is
  'meta = Cloud API (Meta/Datafy); evolution = Evolution API v2; uazapi = UAZAPI.';
comment on column public.whatsapp_configs.instance_token is
  'Token da instância — chave de roteamento do webhook nos provedores de instância.';

notify pgrst, 'reload schema';
