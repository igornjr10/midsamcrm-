-- OpenWA como quarto provedor de WhatsApp.
--
-- É um painel self-hosted (engine whatsapp-web.js ou Baileys) com uma chave de
-- API só para o servidor inteiro e várias "sessões" dentro dele — uma por
-- número. Encaixa no mesmo desenho dos provedores de instância:
--
--   api_base_url   -> URL do painel
--   instance_name  -> nome da sessão (crm-<company_id>)
--   instance_id    -> uuid da sessão no painel, que é por onde a API chama
--   instance_token -> token nosso, só para rotear o webhook (ver abaixo)
--
-- A chave de API do painel NÃO fica aqui: ela abre todas as sessões de todas as
-- empresas, então mora em secret da function, como a key global do Evolution e
-- o admintoken da UAZAPI.
--
-- instance_token aqui não vem do provedor: é gerado por nós e vai na query do
-- webhook (?openwa=<token>), igual à UAZAPI. O OpenWA não manda nada no corpo
-- do evento que identifique a empresa de forma confiável — o nome da sessão se
-- repete e o id muda se a sessão for recriada.
alter table public.whatsapp_configs
  drop constraint if exists whatsapp_configs_provider_check;

alter table public.whatsapp_configs
  add constraint whatsapp_configs_provider_check
  check (provider in ('meta', 'evolution', 'uazapi', 'openwa'));

comment on column public.whatsapp_configs.provider is
  'meta = Cloud API (Meta/Datafy); evolution = Evolution API v2; uazapi = UAZAPI; openwa = painel OpenWA.';

notify pgrst, 'reload schema';
