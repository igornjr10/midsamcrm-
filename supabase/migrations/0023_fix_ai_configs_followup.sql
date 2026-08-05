-- Conserta a leitura de ai_configs.
--
-- O autoteste do webhook acusou "column ai_configs.followup_timezone does not
-- exist" — e um select que pede uma coluna inexistente falha inteiro, então o
-- SDR ficava sem config nenhuma: não respondia e não transcrevia áudio.
--
-- Duas causas possíveis, e este arquivo cobre as duas:
--   1) as colunas da 0010 não estão na tabela (add ... if not exists resolve);
--   2) estão, mas o cache de schema do PostgREST não enxerga (o notify resolve).
--
-- Tudo idempotente: se já existir, não faz nada.

alter table public.ai_configs
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists followup_timezone text not null default 'America/Sao_Paulo',
  add column if not exists followup_window_start smallint not null default 9,
  add column if not exists followup_window_end smallint not null default 20,
  add column if not exists followup_skip_weekends boolean not null default true,
  add column if not exists followup_only_open_stages boolean not null default true;

-- Força o PostgREST a reler o schema: sem isto, coluna nova continua invisível
-- para a API até o próximo reload automático.
notify pgrst, 'reload schema';
