-- Varredura do histórico com os padrões consertados.
--
-- A 0019 já tinha feito um backfill, mas com os padrões quebrados pelo \b —
-- então quase ninguém foi marcado. Aqui o histórico inteiro é reprocessado e
-- quem pagou vai para a etapa de Ganho, como se o trigger tivesse funcionado
-- desde o começo.
--
-- Idempotente: rodar de novo recalcula o mesmo resultado.

-- ── 1. Marca o sinal a partir das conversas ─────────────────────────────────
-- Por contato: o pagamento mais antigo se houver algum; senão, a intenção mais
-- antiga. O "distinct on" com essa ordenação escolhe exatamente isso.
with sinais as (
  select distinct on (cv.contact_id)
    cv.contact_id,
    cv.created_at,
    cv.content,
    m.label,
    m.signal_type
  from public.conversations cv
  cross join lateral public.closing_signal_match(cv.company_id, cv.content) m
  where coalesce(cv.content, '') <> ''
  order by cv.contact_id, (m.signal_type = 'pagamento') desc, cv.created_at
)
update public.contacts c
set closing_signal_at = s.created_at,
    closing_signal_label = s.label,
    closing_signal_type = s.signal_type,
    closing_signal_excerpt = left(s.content, 300)
from sinais s
where s.contact_id = c.id
  and (c.closing_signal_at is distinct from s.created_at
       or c.closing_signal_type is distinct from s.signal_type);

-- ── 2. Move para Ganho quem pagou ───────────────────────────────────────────
-- Mesmas travas do trigger: só pagamento, só empresa com o automático ligado,
-- e não mexe em quem já está em etapa de Ganho ou Perdido.
with ganho as (
  select distinct on (company_id) company_id, key
  from public.pipeline_stages
  where kind = 'won'
  order by company_id, position
)
update public.contacts c
set stage = g.key
from ganho g
where g.company_id = c.company_id
  and c.closing_signal_type = 'pagamento'
  and c.stage <> g.key
  and coalesce(
        (select a.auto_stage_on_payment from public.ai_configs a where a.company_id = c.company_id),
        true
      )
  -- Etapa atual em aberto, ou apontando para etapa que não existe mais.
  and coalesce(
        (select s.kind from public.pipeline_stages s
         where s.company_id = c.company_id and s.key = c.stage),
        'open'
      ) = 'open';

-- ── 3. Resumo ───────────────────────────────────────────────────────────────
select
  count(*) filter (where closing_signal_type = 'pagamento') as pagaram,
  count(*) filter (where closing_signal_type = 'intencao') as sinalizaram,
  count(*) filter (where closing_signal_at is null) as sem_sinal,
  count(*) as total
from public.contacts;
