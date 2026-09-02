-- Dois buracos do atendimento, que são o mesmo buraco visto de ângulos
-- diferentes: o lead manda mensagem e ninguém fica sabendo.
--
--   1. Não existia lido/não lido. Quem atende abre o Chat e não sabe o que
--      chegou desde ontem — a lista é a mesma de sempre, só reordenada.
--   2. A IA não sabia pedir ajuda. Ela para de responder quando um humano
--      responde (0028), mas o caminho inverso não existia: o lead pedia uma
--      pessoa e nada acontecia até alguém abrir aquela conversa por acaso.
--
-- O terceiro (nada avisa ninguém) é só front — som, título e notificação do
-- navegador não precisam de tabela.

-- ── 1. Lido / não lido ──────────────────────────────────────────────────────
-- Uma linha por (atendente, contato) com o instante da última leitura. O não
-- lido sai da comparação com contacts.last_inbound_at, que o trigger de
-- mensagens já mantém — nada de contador para sair de sincronia.
--
-- Por atendente, não por empresa: dois atendentes na mesma conta enxergam
-- listas diferentes, que é justamente o ponto de marcar leitura.
create table public.conversation_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, contact_id)
);

-- A leitura é sempre "as marcas deste atendente nesta empresa".
create index idx_conversation_reads_company_user
  on public.conversation_reads(company_id, user_id);

alter table public.conversation_reads enable row level security;

create policy "own conversation reads" on public.conversation_reads for all
  using (
    user_id = auth.uid()
    and (company_id in (select public.my_company_ids()) or public.is_super_admin())
  )
  with check (
    user_id = auth.uid()
    and (company_id in (select public.my_company_ids()) or public.is_super_admin())
  );

-- ── 2. Transbordo: o lead pediu uma pessoa ──────────────────────────────────
alter table public.contacts
  add column if not exists needs_human_at timestamptz,
  add column if not exists needs_human_reason text;

comment on column public.contacts.needs_human_at is
  'Quando o lead pediu atendimento humano (o SDR IA chamou chamar_humano). Limpo assim que alguém responde.';
comment on column public.contacts.needs_human_reason is
  'O que o lead queria, na descrição da própria IA — some junto com needs_human_at.';

-- Fila de quem está esperando gente, mais antigo primeiro.
create index idx_contacts_needs_human
  on public.contacts(company_id, needs_human_at)
  where needs_human_at is not null;

-- ── Trigger: quem responde encerra o transbordo ─────────────────────────────
-- Mesma função de sempre (0019 -> 0024 -> 0028) com um bloco a mais. O
-- encerramento mora aqui pelo mesmo motivo que a pausa automática: o humano
-- também responde pelo celular, e nesse caso a mensagem chega pelo echo do
-- webhook, sem passar por tela nenhuma nossa.
create or replace function public.touch_contact_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbound boolean := new.sender = 'contact';
  v_match record;
  v_auto boolean;
  v_pause boolean;
  v_won_stage text;
  v_current_kind text;
begin
  update public.contacts c
  set
    last_interaction_at = greatest(coalesce(c.last_interaction_at, new.created_at), new.created_at),
    last_inbound_at = case when v_inbound
      then greatest(coalesce(c.last_inbound_at, new.created_at), new.created_at)
      else c.last_inbound_at end,
    last_outbound_at = case when v_inbound
      then c.last_outbound_at
      else greatest(coalesce(c.last_outbound_at, new.created_at), new.created_at) end
  where c.id = new.contact_id;

  -- ── Pausa automática ──────────────────────────────────────────────────────
  -- sender = 'user' é o humano: 'ai' é a própria IA e 'contact' é o lead.
  -- Vale para mídia e template também, por isso vem antes do corte por content
  -- vazio: mandar um cardápio também é assumir a conversa.
  --
  -- Duas exceções, ambas 'user' sem ninguém do outro lado do teclado:
  --   history_sync -> importação do histórico antigo do WhatsApp Business;
  --   campaignId   -> disparo em massa, que pausaria a IA da base inteira.
  if new.sender = 'user'
     and coalesce(new.metadata ->> 'source', '') <> 'history_sync'
     and new.metadata ->> 'campaignId' is null
  then
    -- Alguém assumiu: o pedido de atendente foi atendido. Não depende de a IA
    -- estar ligada — o transbordo é sobre a pessoa, não sobre o robô.
    update public.contacts
    set needs_human_at = null,
        needs_human_reason = null
    where id = new.contact_id
      and needs_human_at is not null;

    -- Empresa sem SDR ligado não entra aqui: pausar uma IA que não responde só
    -- deixaria a base inteira marcada como pausada, e ela nasceria muda no dia
    -- em que alguém ligasse o SDR.
    select a.enabled and coalesce(a.pause_ai_on_human_reply, true) into v_pause
    from public.ai_configs a where a.company_id = new.company_id;

    if coalesce(v_pause, false) then
      -- Só quem ainda está ativo: repausar sobrescreveria o motivo de uma
      -- pausa manual antiga a cada mensagem enviada.
      update public.contacts
      set ai_paused = true,
          ai_paused_at = new.created_at,
          ai_paused_reason = 'humano_respondeu'
      where id = new.contact_id
        and ai_paused = false;
    end if;
  end if;

  if coalesce(new.content, '') = '' then
    return new;
  end if;

  select * into v_match
  from public.closing_signal_match(new.company_id, new.content);

  if v_match.label is null then
    return new;
  end if;

  -- Sinal de pagamento sobrescreve intenção registrada antes; fora isso, o
  -- primeiro sinal manda e não se reescreve.
  update public.contacts
  set closing_signal_at = new.created_at,
      closing_signal_label = v_match.label,
      closing_signal_type = v_match.signal_type,
      closing_signal_excerpt = left(new.content, 300)
  where id = new.contact_id
    and (closing_signal_at is null
         or (v_match.signal_type = 'pagamento' and coalesce(closing_signal_type, '') <> 'pagamento'));

  -- ── Avanço automático do funil ────────────────────────────────────────────
  -- Só com pagamento identificado: mover por "vou fechar" encheria a coluna de
  -- Ganho de negócio que ainda não aconteceu.
  if v_match.signal_type <> 'pagamento' then
    return new;
  end if;

  select coalesce(auto_stage_on_payment, true) into v_auto
  from public.ai_configs where company_id = new.company_id;

  if not coalesce(v_auto, true) then
    return new;
  end if;

  select s.key into v_won_stage
  from public.pipeline_stages s
  where s.company_id = new.company_id and s.kind = 'won'
  order by s.position
  limit 1;

  if v_won_stage is null then
    return new;
  end if;

  -- Não mexe em quem já está fechado (ganho ou perdido): reabrir ou remarcar
  -- por causa de uma mensagem antiga seria pior que não fazer nada.
  select s.kind into v_current_kind
  from public.contacts c
  join public.pipeline_stages s
    on s.company_id = c.company_id and s.key = c.stage
  where c.id = new.contact_id;

  if coalesce(v_current_kind, 'open') = 'open' then
    update public.contacts set stage = v_won_stage where id = new.contact_id;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
