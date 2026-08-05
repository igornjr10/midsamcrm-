-- Fechamento automático: separa pagamento de intenção e move o funil sozinho.
--
-- A 0019 marcava o contato quando a conversa dava sinal de fechamento, mas
-- quem movia a etapa era o humano — e não movia. Aqui o sinal passa a ter tipo
-- (pagou de fato x sinalizou que vai fechar) e o contato anda no funil sozinho
-- quando o pagamento aparece.

-- ── Tipo do sinal ───────────────────────────────────────────────────────────
alter table public.closing_patterns
  add column if not exists signal_type text not null default 'intencao'
    check (signal_type in ('pagamento', 'intencao'));

alter table public.contacts
  add column if not exists closing_signal_type text;

comment on column public.contacts.closing_signal_type is
  '"pagamento" quando o dinheiro apareceu na conversa; "intencao" quando o lead só disse que vai fechar.';

-- Dinheiro na mesa.
update public.closing_patterns set signal_type = 'pagamento'
where label in ('Comprovante', 'Pix', 'Pagamento feito', 'Transferência',
                'Boleto pago', 'Valor pago', 'Entrada paga', 'Sinal pago');

-- Promessa: vale acompanhar, mas não é venda.
update public.closing_patterns set signal_type = 'intencao'
where label in ('Autorizou emitir', 'Fechou', 'Aprovado');

-- ── Ligar/desligar o avanço automático ──────────────────────────────────────
alter table public.ai_configs
  add column if not exists auto_stage_on_payment boolean not null default true;

comment on column public.ai_configs.auto_stage_on_payment is
  'Move o contato para a etapa de Ganho quando um pagamento é identificado na conversa.';

-- ── Match agora devolve o tipo ──────────────────────────────────────────────
drop function if exists public.closing_signal_match(uuid, text);

create or replace function public.closing_signal_match(p_company_id uuid, p_text text)
returns table (label text, excerpt text, signal_type text)
language sql
stable
set search_path = public
as $$
  select p.label, substring(public.normalize_text(p_text) from p.pattern), p.signal_type
  from public.closing_patterns p
  where p.active
    and (p.company_id is null or p.company_id = p_company_id)
    and public.normalize_text(p_text) ~ p.pattern
  -- Pagamento ganha de intenção quando os dois casam na mesma mensagem: o
  -- comprovante vale mais do que o "vou fechar" na frase anterior.
  order by (p.signal_type = 'pagamento') desc, p.company_id nulls last
  limit 1;
$$;

-- ── Trigger: datas, sinal e agora também a etapa ────────────────────────────
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
