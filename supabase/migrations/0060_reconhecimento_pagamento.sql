-- Reconhecimento de pagamento mais preciso.
--
-- Três correções sobre o que a 0024/0025/0038 montaram:
--
-- 1) "comprovante" sozinho contava como pagamento. Em venda financiada isso é
--    "comprovante de renda", "comprovante de residência", "vou mandar o
--    comprovante depois" — e o lead ia para Ganho sem ter pago nada. Agora só
--    frase de quem entregou o comprovante do pagamento.
-- 2) Mensagem da IA também disparava sinal: "assim que pagar me manda o
--    comprovante" marcaria o próprio lead como pago. Sinal agora vem só do lead
--    e do atendente.
-- 3) O comprovante em foto/PDF, que é o mais comum, não tinha texto para casar.
--    O webhook passa a ler a imagem com IA e registra o pagamento por
--    register_payment_signal — a mesma regra do gatilho, num lugar só.

-- ── 1. Padrão "Comprovante" ─────────────────────────────────────────────────
-- Três jeitos de o comprovante chegar como texto:
--   frase de entrega ("segue em anexo o comprovante", "mandei o comprovante");
--   "comprovante do pix / de pagamento";
--   o nome do arquivo — PDF enviado no WhatsApp chega com o nome como texto
--   ("Comprovante_10-09-2026.pdf", "ComprovanteSantander-178...pdf"), e foi
--   assim que a maioria dos pagamentos reais foi reconhecida até aqui.
update public.closing_patterns
set pattern = '(segue|seguem|ta\s+ai|esta\s+ai|ta\s+aqui|aqui\s+esta|mandei|enviei|encaminhei|anexei|consegui\s+(te\s+)?enviar|consegui\s+(te\s+)?mandar)\s+(em\s+anexo\s+)?(o\s+|os\s+|a\s+)?comprovante'
           || '|comprovante\s+(do|de|da)\s+(pix|pagamento|transferencia|deposito|ted|doc|boleto)'
           || '|comprovante[^
]{0,80}\.(pdf|jpe?g|png|heic|webp)'
where company_id is null and label = 'Comprovante';

-- ── 2 e 3. Registro do sinal + avanço do funil, num lugar só ────────────────
-- Usado pelo gatilho (texto) e pelo webhook (comprovante lido na imagem).
create or replace function public.register_closing_signal(
  p_contact_id uuid,
  p_label text,
  p_signal_type text,
  p_excerpt text,
  p_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_auto boolean;
  v_won_stage text;
  v_current_kind text;
begin
  select company_id into v_company_id from public.contacts where id = p_contact_id;
  if v_company_id is null then
    return;
  end if;

  -- Sinal de pagamento sobrescreve intenção registrada antes; fora isso, o
  -- primeiro sinal manda e não se reescreve.
  update public.contacts
  set closing_signal_at = p_at,
      closing_signal_label = p_label,
      closing_signal_type = p_signal_type,
      closing_signal_excerpt = left(p_excerpt, 300)
  where id = p_contact_id
    and (closing_signal_at is null
         or (p_signal_type = 'pagamento' and coalesce(closing_signal_type, '') <> 'pagamento'));

  -- Só com pagamento identificado: mover por "vou fechar" encheria a coluna de
  -- Ganho de negócio que ainda não aconteceu.
  if p_signal_type <> 'pagamento' then
    return;
  end if;

  select coalesce(auto_stage_on_payment, true) into v_auto
  from public.ai_configs where company_id = v_company_id;
  if not coalesce(v_auto, true) then
    return;
  end if;

  select s.key into v_won_stage
  from public.pipeline_stages s
  where s.company_id = v_company_id and s.kind = 'won'
  order by s.position
  limit 1;
  if v_won_stage is null then
    return;
  end if;

  -- Não mexe em quem já está fechado (ganho ou perdido): reabrir ou remarcar
  -- por causa de uma mensagem antiga seria pior que não fazer nada.
  select s.kind into v_current_kind
  from public.contacts c
  join public.pipeline_stages s on s.company_id = c.company_id and s.key = c.stage
  where c.id = p_contact_id;

  if coalesce(v_current_kind, 'open') = 'open' then
    update public.contacts set stage = v_won_stage where id = p_contact_id;
  end if;
end;
$$;

-- Só o webhook (service role) chama: o front não registra pagamento por aqui.
revoke all on function public.register_closing_signal(uuid, text, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.touch_contact_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbound boolean := new.sender = 'contact';
  v_match record;
  v_pause boolean;
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
    update public.contacts
    set needs_human_at = null,
        needs_human_reason = null
    where id = new.contact_id
      and needs_human_at is not null;

    select a.enabled and coalesce(a.pause_ai_on_human_reply, true) into v_pause
    from public.ai_configs a where a.company_id = new.company_id;

    if coalesce(v_pause, false) then
      update public.contacts
      set ai_paused = true,
          ai_paused_at = new.created_at,
          ai_paused_reason = 'humano_respondeu'
      where id = new.contact_id
        and ai_paused = false;
    end if;
  end if;

  -- A IA não gera sinal de fechamento: o que ela escreve ("me manda o
  -- comprovante quando pagar") é pedido, não fato.
  if new.sender = 'ai' or coalesce(new.content, '') = '' then
    return new;
  end if;

  select * into v_match
  from public.closing_signal_match(new.company_id, new.content);

  if v_match.label is null then
    return new;
  end if;

  -- Pedido não é entrega: "me manda o comprovante de pagamento" casa com
  -- "comprovante de pagamento", mas quem pagou ainda não pagou. E documento de
  -- cadastro ("comprovante de renda.pdf") não é pagamento.
  if v_match.label = 'Comprovante'
     and (
       public.normalize_text(new.content)
         ~ '\y(manda|mande|mandar|envia|envie|passa|passar|precis\w*|falta|aguardo|esperando)\s+(me\s+)?(o\s+|a\s+)?comprovante'
       or public.normalize_text(new.content)
         ~ 'comprovante[\s_-]*(de[\s_-]*)?(renda|residencia|endereco|matricula|vacina|escolaridade)'
     )
  then
    return new;
  end if;

  perform public.register_closing_signal(
    new.contact_id, v_match.label, v_match.signal_type, new.content, new.created_at
  );

  return new;
end;
$$;
