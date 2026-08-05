-- A IA se cala quando o vendedor entra na conversa.
--
-- O botão "Pausar IA" do Chat já existia, mas dependia de alguém lembrar de
-- clicar antes de responder. Na prática o vendedor respondia o lead e a IA
-- respondia junto, dois atendimentos em cima da mesma mensagem.
--
-- Agora qualquer mensagem saída de humano — pelo Chat ou pelo celular
-- (Coexistence manda o echo para o webhook) — pausa a IA naquele contato. Quem
-- despausa é o humano, pelo mesmo botão: a IA não volta sozinha porque não tem
-- como saber que o vendedor terminou.

-- ── Ligar/desligar por empresa ──────────────────────────────────────────────
alter table public.ai_configs
  add column if not exists pause_ai_on_human_reply boolean not null default true;

comment on column public.ai_configs.pause_ai_on_human_reply is
  'Pausa o SDR IA no contato assim que um atendente humano responde a conversa.';

-- ── Por que a IA está pausada ───────────────────────────────────────────────
-- ai_paused sozinho não distingue "o vendedor assumiu agora" de "alguém pausou
-- há três semanas" — e é essa diferença que o Chat mostra para explicar o
-- silêncio da IA.
alter table public.contacts
  add column if not exists ai_paused_at timestamptz;

alter table public.contacts
  add column if not exists ai_paused_reason text;

comment on column public.contacts.ai_paused_reason is
  '"humano_respondeu" quando a pausa foi automática; null quando foi manual.';

-- ── Trigger: datas, sinal, etapa e agora a pausa ────────────────────────────
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
