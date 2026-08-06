-- A IA para de falar com quem já está em etapa fechada.
--
-- A 0028 fez a IA se calar quando um humano responde. Faltava o caso em que
-- ninguém respondeu: a 0024 move o contato para Ganho sozinha ao identificar o
-- pagamento, e a IA seguia conversando com um cliente que já fechou. Mudança de
-- etapa não é mensagem, então nada pausava.
--
-- Aqui a etapa vira condição de resposta em vez de pausa. A diferença importa:
-- se o negócio for reaberto (voltar para uma etapa 'open'), a IA volta sozinha,
-- e ai_paused continua significando só "alguém calou a IA nesta conversa".

alter table public.ai_configs
  add column if not exists ai_only_open_stages boolean not null default true;

comment on column public.ai_configs.ai_only_open_stages is
  'A IA não responde nem faz follow-up de contato em etapa de Ganho ou Perdido.';

-- ── Etapa do contato está fechada? ──────────────────────────────────────────
-- Pela `kind` da etapa, não pela chave: quem renomeou o funil tem 'fechado' ou
-- 'cliente' no lugar de 'won', e comparar string erraria em todas elas.
--
-- Contato em etapa que não existe mais em pipeline_stages conta como aberta —
-- calar a IA por causa de uma etapa órfã seria pior do que responder.
create or replace function public.contact_in_closed_stage(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.kind, 'open') <> 'open'
  from public.contacts c
  left join public.pipeline_stages s
    on s.company_id = c.company_id and s.key = c.stage
  where c.id = p_contact_id;
$$;

-- Só o webhook (service_role). Sendo security definer, abrir para authenticated
-- deixaria qualquer usuário sondar contato de outra empresa passando o id.
grant execute on function public.contact_in_closed_stage(uuid) to service_role;

-- ── Follow-up: mesma definição de "fechada" ─────────────────────────────────
-- O filtro era `c.stage not in ('won', 'lost')`, escrito na 0010, antes de a
-- 0018 deixar o funil configurável. Empresa que criou as próprias etapas
-- recebia follow-up de negócio já ganho. Agora as duas pontas da IA — resposta
-- e cadência — leem a mesma coluna.
create or replace function public.followup_candidates(
  p_company_id uuid,
  p_open_only boolean default true,
  p_limit integer default 200
)
returns table (
  contact_id uuid,
  name text,
  phone text,
  email text,
  stage text,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_followup_at timestamptz,
  followups_done integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone,
    c.email,
    c.stage,
    m.last_inbound_at,
    m.last_message_at,
    f.last_followup_at,
    coalesce(f.done, 0)::integer
  from public.contacts c
  join lateral (
    select
      max(v.created_at) filter (where v.sender = 'contact') as last_inbound_at,
      max(v.created_at) as last_message_at
    from public.conversations v
    where v.contact_id = c.id
  ) m on true
  left join lateral (
    select max(l.created_at) as last_followup_at, count(*) as done
    from public.followup_logs l
    where l.contact_id = c.id
      and (m.last_inbound_at is null or l.created_at > m.last_inbound_at)
  ) f on true
  left join public.pipeline_stages s
    on s.company_id = c.company_id and s.key = c.stage
  where c.company_id = p_company_id
    and c.ai_paused = false
    and nullif(trim(c.phone), '') is not null
    and m.last_message_at is not null
    and (not p_open_only or coalesce(s.kind, 'open') = 'open')
  order by m.last_message_at asc
  limit p_limit;
$$;

grant execute on function public.followup_candidates(uuid, boolean, integer) to service_role;

notify pgrst, 'reload schema';
