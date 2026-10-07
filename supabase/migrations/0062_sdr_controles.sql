-- Controles do SDR na ferramenta, fora do prompt.
--
-- Tempo de resposta, quem o SDR atende e para quem ele passa a conversa eram
-- coisas que o cliente tentava escrever no prompt ("espere 30 segundos",
-- "só responda quem veio do anúncio") — e o modelo não tem como cumprir: ele só
-- roda quando o webhook chama. Aqui elas viram configuração que o webhook
-- aplica antes de chamar a IA.

-- ── Tempo de resposta ───────────────────────────────────────────────────────
-- Segundos. O teto existe porque a espera acontece dentro da edge function,
-- que tem limite de tempo de execução: espera + resposta precisam caber nele.
alter table public.ai_configs
  add column if not exists reply_first_delay_seconds smallint not null default 0
    check (reply_first_delay_seconds between 0 and 90),
  add column if not exists reply_delay_seconds smallint not null default 0
    check (reply_delay_seconds between 0 and 90),
  add column if not exists reply_debounce_seconds smallint not null default 0
    check (reply_debounce_seconds between 0 and 60);

comment on column public.ai_configs.reply_first_delay_seconds is
  'Espera antes da primeira resposta da IA a um contato.';
comment on column public.ai_configs.reply_delay_seconds is
  'Espera antes das respostas seguintes.';
comment on column public.ai_configs.reply_debounce_seconds is
  'Janela para juntar mensagens seguidas do lead numa resposta só.';

-- ── Ativação ────────────────────────────────────────────────────────────────
alter table public.ai_configs
  add column if not exists only_new_leads boolean not null default false,
  add column if not exists activated_at timestamptz,
  add column if not exists trigger_phrases text[] not null default '{}',
  add column if not exists allowed_sources text[] not null default '{}',
  add column if not exists excluded_tags text[] not null default '{}';

comment on column public.ai_configs.only_new_leads is
  'Só atende contato sem nenhuma conversa anterior a activated_at.';
comment on column public.ai_configs.activated_at is
  'Quando o SDR foi ligado: a linha que separa lead novo de contato antigo.';
comment on column public.ai_configs.trigger_phrases is
  'Se preenchido, o SDR só começa a atender quando a mensagem do lead contém uma destas frases.';
comment on column public.ai_configs.allowed_sources is
  'Se preenchido, o SDR só começa a atender contatos destas origens (contacts.source).';
comment on column public.ai_configs.excluded_tags is
  'Contatos com qualquer uma destas etiquetas nunca são atendidos pelo SDR.';

-- ── Encaminhamento e insistência ────────────────────────────────────────────
alter table public.ai_configs
  add column if not exists handoff_user_id uuid references auth.users(id) on delete set null,
  add column if not exists max_unanswered smallint not null default 0
    check (max_unanswered between 0 and 20),
  add column if not exists prompt_fields jsonb not null default '{}'::jsonb;

comment on column public.ai_configs.handoff_user_id is
  'Quem recebe a conversa quando a IA chama uma pessoa (vira o responsável do contato).';
comment on column public.ai_configs.max_unanswered is
  'Máximo de mensagens seguidas sem resposta do lead (follow-up incluído). 0 = sem limite.';
comment on column public.ai_configs.prompt_fields is
  'Campos do formulário que monta o prompt (nome, objetivo, produtos...).';

-- activated_at anda sozinho: ligar o SDR (ou ligar "só leads novos" com o SDR
-- já ligado e sem data) marca o agora. Desligar não apaga — religar marca de novo.
create or replace function public.ai_configs_set_activated_at()
returns trigger
language plpgsql
as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not coalesce(old.enabled, false)) then
    new.activated_at := now();
  elsif new.enabled and new.only_new_leads and new.activated_at is null then
    new.activated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists ai_configs_set_activated_at on public.ai_configs;
create trigger ai_configs_set_activated_at
  before insert or update on public.ai_configs
  for each row execute function public.ai_configs_set_activated_at();

-- Quem já está ligado: a partir de agora conta como ativação. Assim ligar
-- "só leads novos" hoje não trata a base inteira como nova.
update public.ai_configs set activated_at = now() where enabled and activated_at is null;

-- 0054 trocou o SELECT da tabela por SELECT por coluna: coluna nova precisa
-- de grant próprio, senão o navegador não lê.
grant select (
  reply_first_delay_seconds, reply_delay_seconds, reply_debounce_seconds,
  only_new_leads, activated_at, trigger_phrases, allowed_sources, excluded_tags,
  handoff_user_id, max_unanswered, prompt_fields
) on public.ai_configs to authenticated;

-- ── Contato ─────────────────────────────────────────────────────────────────
alter table public.contacts
  add column if not exists sdr_engaged_at timestamptz,
  add column if not exists handoff_summary text;

comment on column public.contacts.sdr_engaged_at is
  'Quando o SDR começou a atender este contato. Depois disso as regras de ativação não se aplicam mais: a conversa segue.';
comment on column public.contacts.handoff_summary is
  'Resumo do que a IA coletou, escrito quando ela passou a conversa para uma pessoa.';

-- ── Prévia de quem seria atendido ───────────────────────────────────────────
-- Primeira mensagem de cada contato: é o que separa lead novo de antigo. A tela
-- calcula a prévia com as regras ainda não salvas, então só precisa disto.
create or replace function public.contact_first_message_at(p_company_id uuid)
returns table (contact_id uuid, first_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select cv.contact_id, min(cv.created_at)
  from public.conversations cv
  where cv.company_id = p_company_id
    and (p_company_id in (select public.my_company_ids()) or public.is_super_admin())
  group by cv.contact_id;
$$;

grant execute on function public.contact_first_message_at(uuid) to authenticated;

notify pgrst, 'reload schema';
