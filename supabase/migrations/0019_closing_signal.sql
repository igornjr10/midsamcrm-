-- Sinal de fechamento + datas de interação no contato.
--
-- Duas coisas que só existiam espalhadas nas mensagens e agora ficam no
-- contato, prontas para filtrar e disparar:
--
-- 1) quando o lead falou pela última vez, quando nós falamos, e quando foi a
--    última interação de qualquer lado — é o que sustenta "sem resposta há 3
--    dias" e "sumido há 30 dias" sem varrer conversations a cada consulta;
-- 2) sinal de fechamento: a mensagem casou com um padrão de quem pagou ou
--    mandou fechar (pix, comprovante, pode emitir...).
--
-- Tudo é mantido por trigger na entrada da mensagem: custo por mensagem nova,
-- zero custo na leitura.

alter table public.contacts
  add column last_interaction_at timestamptz,
  add column last_inbound_at timestamptz,
  add column last_outbound_at timestamptz,
  add column closing_signal_at timestamptz,
  add column closing_signal_excerpt text,
  add column closing_signal_label text;

comment on column public.contacts.last_inbound_at is 'Última mensagem recebida do lead.';
comment on column public.contacts.last_outbound_at is 'Última mensagem enviada por atendente ou IA.';
comment on column public.contacts.closing_signal_excerpt is 'Trecho da mensagem que disparou o sinal, para conferência humana.';

create index idx_contacts_last_interaction on public.contacts(company_id, last_interaction_at desc nulls last);
create index idx_contacts_closing_signal on public.contacts(company_id, closing_signal_at desc)
  where closing_signal_at is not null;

-- ── Padrões de fechamento ───────────────────────────────────────────────────
-- Em tabela, não no código: dá para acrescentar expressão sem deploy.
-- company_id nulo = vale para todas as empresas.
create table public.closing_patterns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  label text not null,
  -- Regex POSIX aplicada sobre o texto minúsculo e sem acento.
  pattern text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.closing_patterns enable row level security;

create policy "read closing patterns" on public.closing_patterns for select
  using (company_id is null or company_id in (select public.my_company_ids()) or public.is_super_admin());

create policy "write own closing patterns" on public.closing_patterns for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

-- Acento fora e minúsculo: "TRANSFERÊNCIA" e "transferencia" casam no mesmo
-- padrão, sem depender da extensão unaccent.
create or replace function public.normalize_text(p_text text)
returns text
language sql
immutable
as $$
  select translate(
    lower(coalesce(p_text, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  );
$$;

-- Devolve (label, trecho) do primeiro padrão que casar, ou nada.
create or replace function public.closing_signal_match(p_company_id uuid, p_text text)
returns table (label text, excerpt text)
language sql
stable
set search_path = public
as $$
  select p.label, substring(public.normalize_text(p_text) from p.pattern)
  from public.closing_patterns p
  where p.active
    and (p.company_id is null or p.company_id = p_company_id)
    and public.normalize_text(p_text) ~ p.pattern
  order by p.company_id nulls last
  limit 1;
$$;

-- Padrões padrão. "entrada" e "sinal" só contam com contexto de pagamento:
-- soltos eles pegariam "entrada do salão" e "sinal de internet".
insert into public.closing_patterns (label, pattern) values
  ('Comprovante',      'comprovante'),
  ('Pix',              '(fiz|mandei|enviei|segue|ta ai o|paguei (via|no|por) )?\s*pix\b|pix (feito|enviado|realizado|pago)'),
  ('Pagamento feito',  'pag(amento|uei)\s*(ja\s*)?(foi\s*)?(realizado|confirmado|recebido|efetuado|feito|concluido)|ja paguei|acabei de pagar'),
  ('Transferência',    'transferencia (feita|realizada|enviada)|fiz a transferencia'),
  ('Boleto pago',      'boleto (pago|quitado)'),
  ('Valor pago',       'valor (ja\s*)?(foi\s*)?(pago|depositado|transferido)'),
  ('Entrada paga',     '(paguei|pagamos|fiz|dei|mandei)\s*(a|o)?\s*(valor d[ao]\s*)?entrada|entrada (paga|feita|realizada)'),
  ('Sinal pago',       '(paguei|pagamos|dei|mandei)\s*(o\s*)?sinal|sinal (pago|feito|realizado)'),
  ('Autorizou emitir', 'pode (emitir|gerar|fazer)\s*(a|o)?\s*(nota|nf|contrato|pedido|ordem)'),
  ('Fechou',           'vou fechar|pode fechar|fechado\b|fechamos|quero fechar|bora fechar|ta fechado'),
  ('Aprovado',         'aprovado\b|foi aprovado|aprovamos|orcamento aprovado');

-- ── Trigger: mantém datas e sinal a cada mensagem ───────────────────────────
create or replace function public.touch_contact_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbound boolean := new.sender = 'contact';
  v_match record;
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

  -- O sinal olha os dois lados: "pode emitir a nota" vem do lead, "pagamento
  -- confirmado" costuma vir do atendente. O primeiro sinal manda — depois disso
  -- o contato já está marcado e não se reescreve.
  if coalesce(new.content, '') <> '' then
    select * into v_match
    from public.closing_signal_match(new.company_id, new.content);

    if v_match.label is not null then
      update public.contacts
      set closing_signal_at = new.created_at,
          closing_signal_label = v_match.label,
          closing_signal_excerpt = left(new.content, 300)
      where id = new.contact_id and closing_signal_at is null;
    end if;
  end if;

  return new;
end;
$$;

create trigger touch_contact_on_message
  after insert on public.conversations
  for each row execute function public.touch_contact_on_message();

-- ── Backfill do histórico ───────────────────────────────────────────────────
update public.contacts c
set last_interaction_at = agg.ultima,
    last_inbound_at = agg.ultima_lead,
    last_outbound_at = agg.ultima_nossa
from (
  select contact_id,
         max(created_at) as ultima,
         max(created_at) filter (where sender = 'contact') as ultima_lead,
         max(created_at) filter (where sender in ('user', 'ai')) as ultima_nossa
  from public.conversations
  group by contact_id
) agg
where agg.contact_id = c.id;

-- Primeira mensagem que casou, por contato.
with sinais as (
  select distinct on (cv.contact_id)
    cv.contact_id, cv.created_at, cv.content, m.label
  from public.conversations cv
  cross join lateral public.closing_signal_match(cv.company_id, cv.content) m
  where coalesce(cv.content, '') <> ''
  order by cv.contact_id, cv.created_at
)
update public.contacts c
set closing_signal_at = s.created_at,
    closing_signal_label = s.label,
    closing_signal_excerpt = left(s.content, 300)
from sinais s
where s.contact_id = c.id;
