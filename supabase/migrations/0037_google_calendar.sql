-- Google Agenda: o calendário da empresa e a agenda do CRM passam a ser o mesmo.
--
-- O que muda para quem usa: o compromisso marcado aqui aparece no celular de
-- quem estiver na conta Google conectada, e o que a equipe marca direto no
-- Google aparece na Agenda — inclusive para o SDR IA responder "esse horário
-- já está ocupado" com base no que existe de verdade.
--
-- Três peças:
--   1. google_calendar_configs — a conexão OAuth da empresa (uma por empresa).
--   2. colunas em appointments — o par entre a linha daqui e o evento de lá.
--   3. google_calendar_outbox — a fila do que ainda falta mandar ao Google.
--
-- A fila existe porque compromisso não nasce só na tela: o SDR IA grava
-- 'pending' pelo webhook do WhatsApp, e um dia outro processo vai gravar
-- também. Um trigger na tabela pega todos eles; chamar a API do Google no
-- ponto de escrita pegaria só a tela — e derrubaria a escrita junto quando o
-- Google estivesse fora do ar.

-- ── Conexão da empresa ──────────────────────────────────────────────────────
create table public.google_calendar_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  -- Quem conectou. Vira o dono (user_id) dos compromissos importados do Google,
  -- que não têm autor nenhum deste lado.
  user_id uuid not null references auth.users(id) on delete cascade,
  google_email text,
  -- 'primary' = o calendário principal da conta conectada.
  calendar_id text not null default 'primary',
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  -- Token de sincronização incremental do Google: a próxima leitura traz só o
  -- que mudou desde a anterior, em vez do calendário inteiro.
  sync_token text,
  last_sync_at timestamptz,
  last_error text,
  -- Vai a false quando o Google recusa o refresh token (acesso revogado na
  -- conta Google). A UI usa isso para pedir a reconexão em vez de repetir
  -- chamadas que já se sabe que vão falhar.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS ligado e sem policy nenhuma: a tabela guarda refresh token, que dá acesso
-- contínuo à conta Google do cliente. Nem o dono da empresa lê isso do browser
-- — quem lê é a edge function, com service role. O status que a tela mostra vem
-- da própria function (action=status).
alter table public.google_calendar_configs enable row level security;

create trigger update_google_calendar_configs_updated_at
  before update on public.google_calendar_configs
  for each row execute function public.update_updated_at_column();

-- ── Estado do OAuth ─────────────────────────────────────────────────────────
-- O Google só devolve `state` na volta; é ele que diz de qual empresa era o
-- consentimento. Uma linha por tentativa, de uso único e com validade curta.
create table public.google_oauth_states (
  state text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_to text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

alter table public.google_oauth_states enable row level security;

-- ── O par com o evento do Google ────────────────────────────────────────────
alter table public.appointments
  add column if not exists google_event_id text,
  -- Carimbo de "esta escrita veio do Google". É o que quebra o eco: sem ele,
  -- aplicar aqui uma mudança de lá reenfileiraria a mesma mudança de volta
  -- para lá, para sempre. Só o sync toca nesta coluna.
  add column if not exists google_synced_at timestamptz;

create unique index if not exists appointments_google_event_uniq
  on public.appointments(company_id, google_event_id)
  where google_event_id is not null;

comment on column public.appointments.google_event_id is
  'Id do evento correspondente no Google Calendar. Nulo = só existe no CRM.';

-- ── Fila de saída ───────────────────────────────────────────────────────────
create table public.google_calendar_outbox (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Sem FK: a fila precisa sobreviver ao delete da linha que a gerou, senão o
  -- evento nunca seria apagado do Google.
  appointment_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  -- Guardado no enfileiramento porque no delete a linha já não existe para ser
  -- consultada na hora de processar.
  google_event_id text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index idx_google_outbox_company on public.google_calendar_outbox(company_id, id);

alter table public.google_calendar_outbox enable row level security;

create or replace function public.enqueue_google_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_connected boolean;
begin
  -- O ramo do DELETE vem antes de qualquer leitura de NEW: em trigger de
  -- DELETE o registro NEW não é atribuído, e tocar num campo dele aborta o
  -- delete com "record new is not assigned yet".
  if tg_op = 'DELETE' then
    v_company := old.company_id;
  else
    v_company := new.company_id;
  end if;

  select true into v_connected
  from public.google_calendar_configs
  where company_id = v_company and active
  limit 1;

  -- Empresa sem Google conectado não acumula fila.
  if v_connected is not true then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.google_event_id is not null then
      insert into public.google_calendar_outbox (company_id, appointment_id, op, google_event_id)
      values (old.company_id, old.id, 'delete', old.google_event_id);
    end if;
    return old;
  end if;

  -- Escrita do próprio sync: ignora (ver comentário de google_synced_at).
  if tg_op = 'INSERT' and new.google_synced_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.google_synced_at is distinct from old.google_synced_at then
    return new;
  end if;

  insert into public.google_calendar_outbox (company_id, appointment_id, op, google_event_id)
  values (new.company_id, new.id, 'upsert', new.google_event_id);
  return new;
end;
$$;

create trigger appointments_google_sync
  after insert or update or delete on public.appointments
  for each row execute function public.enqueue_google_calendar_sync();

notify pgrst, 'reload schema';
