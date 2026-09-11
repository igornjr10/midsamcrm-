-- Fechamento das brechas encontradas na auditoria de segurança.
--
-- Quatro coisas, em ordem de gravidade:
--
--   1. profiles.is_super_admin era editável pelo próprio usuário. A policy
--      "own profile" é FOR ALL, e a coluna nasceu na mesma tabela (0007) sem
--      nada que a protegesse: um PATCH com a anon key virava super admin.
--   2. Sete funções security definer antigas ficaram com EXECUTE para PUBLIC
--      (o padrão do Postgres). Duas devolvem contatos de qualquer empresa.
--   3. Segredos (token da Meta, token da instância, chave OpenAI) chegavam ao
--      navegador de qualquer membro da empresa via SELECT *.
--   4. api_base_url era gravável pelo cliente e usado como destino de fetch
--      com o token no header (SSRF + exfiltração do token).

-- ── 1. Flags de administração só mudam por quem opera o banco ────────────────
-- Trigger em vez de policy: policy não distingue coluna, e trocar a FOR ALL
-- por quatro policies deixaria a mesma fresta para a próxima coluna sensível.
-- current_user é 'authenticated'/'anon' nas requisições do PostgREST e
-- 'postgres'/'service_role' no SQL Editor, migrations e edge functions.
create or replace function public.protect_profile_admin_flags()
returns trigger
language plpgsql
as $$
declare
  v_trusted boolean := current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');
begin
  if v_trusted then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.is_super_admin, false) or coalesce(new.hidden_admin, false) then
      raise exception 'flags de administração não podem ser definidas pelo cliente';
    end if;
    return new;
  end if;
  if new.is_super_admin is distinct from old.is_super_admin
     or new.hidden_admin is distinct from old.hidden_admin
     or new.user_id is distinct from old.user_id then
    raise exception 'flags de administração não podem ser alteradas pelo cliente';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_admin_flags on public.profiles;
create trigger protect_profile_admin_flags
  before insert or update on public.profiles
  for each row execute function public.protect_profile_admin_flags();

-- ── 2. Funções de serviço saem do alcance do cliente ─────────────────────────
-- Só as edge functions (service_role) chamam estas. Nenhuma tela usa.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.followup_candidates(uuid, boolean, int)',
    'public.find_contact_by_phone(uuid, text)',
    'public.library_for_ai(uuid)',
    'public.agenda_for_ai(uuid, timestamptz, timestamptz)',
    'public.contact_in_closed_stage(uuid)',
    'public.seed_default_pipeline_stages(uuid)',
    'public.recount_campaign(uuid)'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when undefined_function then
      raise notice 'função % não existe, pulando', f;
    end;
  end loop;
end;
$$;

-- ── 3. Segredos não vão ao navegador ─────────────────────────────────────────
-- Colunas derivadas dizem "tem token?" sem entregar o token: é o que a tela
-- precisa para saber se está configurado.
alter table public.whatsapp_configs
  add column if not exists has_access_token boolean
    generated always as (coalesce(access_token, '') <> '') stored;

alter table public.ai_configs
  add column if not exists has_openai_api_key boolean
    generated always as (coalesce(openai_api_key, '') <> '') stored;

-- SELECT passa a ser por coluna: tudo menos os segredos. INSERT e UPDATE
-- continuam na tabela inteira — gravar o token é permitido, ler não.
-- Lista montada do catálogo para não depender de enumerar coluna por coluna.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'whatsapp_configs'
    and column_name not in ('access_token', 'instance_token');
  revoke select on public.whatsapp_configs from anon, authenticated;
  execute format('grant select (%s) on public.whatsapp_configs to authenticated', v_cols);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ai_configs'
    and column_name not in ('openai_api_key');
  revoke select on public.ai_configs from anon, authenticated;
  execute format('grant select (%s) on public.ai_configs to authenticated', v_cols);
end;
$$;

-- ── 4. api_base_url só aponta para onde a empresa realmente fala ─────────────
-- O cliente grava a config do provedor Meta; os outros provedores são
-- gravados pelas edge functions (service_role), que passam direto.
create or replace function public.guard_whatsapp_api_base_url()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.api_base_url is not distinct from old.api_base_url then
    return new;
  end if;
  if new.api_base_url !~ '^https://(cloud\.datafyapi\.com\.br|graph\.facebook\.com)(/|$)' then
    raise exception 'api_base_url fora da lista permitida';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_whatsapp_api_base_url on public.whatsapp_configs;
create trigger guard_whatsapp_api_base_url
  before insert or update on public.whatsapp_configs
  for each row execute function public.guard_whatsapp_api_base_url();

notify pgrst, 'reload schema';
