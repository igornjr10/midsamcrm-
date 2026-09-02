-- Duas lacunas que só aparecem quando o atendimento sai de uma pessoa só.
--
--   1. Nenhuma conversa tem dono. Com dois atendentes na mesma conta, os dois
--      veem a mesma fila inteira e acabam respondendo o mesmo lead — ou nenhum
--      responde, cada um achando que o outro pegou.
--   2. A IA responde 3h da manhã como se fosse meio-dia. A janela de horário
--      existe desde a 0010, mas só para o follow-up: quem dispara é o cron, e
--      ele já sabia respeitar horário. A resposta a mensagem recebida nasce no
--      webhook e nunca olhou relógio nenhum.

-- ── 1. Dono da conversa ─────────────────────────────────────────────────────
-- Fica no contato, e não numa tabela de atribuição: a conversa é do contato, e
-- o atendimento não muda de dono no meio de uma mensagem. Uma tabela à parte só
-- faria sentido com histórico de transferências, que ninguém pediu.
alter table public.contacts
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

comment on column public.contacts.assigned_to is
  'Atendente responsável por esta conversa. Null = ninguém pegou; a fila é de todos.';

-- on delete set null: atendente que sai da empresa devolve as conversas para a
-- fila em vez de levar os contatos junto.
create index if not exists idx_contacts_assigned
  on public.contacts(company_id, assigned_to)
  where assigned_to is not null;

-- Quem pode receber uma conversa.
--
-- O e-mail mora em auth.users, que o cliente não lê nem com RLS aberta, e
-- profiles só deixa cada um ler o próprio (0001). Sem esta function o seletor
-- de responsável mostraria uma lista de uuids.
--
-- SECURITY DEFINER com o filtro de empresa dentro: sem ele, qualquer usuário
-- autenticado listaria os membros e e-mails de qualquer empresa da plataforma.
create or replace function public.company_team_members(p_company_id uuid)
returns table (user_id uuid, email text, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    u.email::text,
    p.full_name,
    m.role
  from public.company_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.company_id = p_company_id
    and (
      p_company_id in (select public.my_company_ids())
      or public.is_super_admin()
    )
  order by (m.role = 'admin') desc, u.email;
$$;

grant execute on function public.company_team_members(uuid) to authenticated;

-- ── 2. Horário de atendimento da IA ─────────────────────────────────────────
-- Desligado por padrão: quem já está rodando com a IA 24h não pode emudecer de
-- madrugada por causa de uma migration.
--
-- Reaproveita followup_timezone em vez de criar outro fuso: duas colunas de
-- fuso na mesma empresa é uma pergunta que ninguém quer responder duas vezes.
alter table public.ai_configs
  add column if not exists reply_window_enabled boolean not null default false,
  add column if not exists reply_window_start smallint not null default 8,
  add column if not exists reply_window_end smallint not null default 20,
  add column if not exists reply_skip_weekends boolean not null default false,
  -- Null = a IA simplesmente não responde fora do horário. Preenchido, ela
  -- manda esta frase uma vez e cala — a mensagem do lead continua na fila do
  -- dia seguinte, marcada como não lida.
  add column if not exists reply_offhours_message text;

comment on column public.ai_configs.reply_window_enabled is
  'Liga o horário de atendimento da IA. Fora dele ela não responde (ver reply_offhours_message).';
comment on column public.ai_configs.reply_offhours_message is
  'Aviso enviado uma vez a cada 12h quando chega mensagem fora do horário. Null = silêncio total.';

notify pgrst, 'reload schema';
