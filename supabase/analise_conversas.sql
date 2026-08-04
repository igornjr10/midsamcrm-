-- Raio-x das conversas — cole inteiro no SQL Editor do Supabase e rode.
--
-- Devolve UMA tabela (metrica | detalhe | valor). Não sai conteúdo de mensagem,
-- só contagens e tempos. A empresa é escolhida sozinha: a que casar com
-- "midsam", ou a mais antiga se não casar nenhuma.
--
-- Arquivo descartável de diagnóstico; pode apagar depois.

with alvo as (
  select id, name from public.companies
  order by (name ilike '%midsam%') desc, created_at
  limit 1
),
msgs as (
  select c.* from public.conversations c join alvo a on c.company_id = a.id
),
pares as (
  select
    sender,
    lead(sender) over (partition by contact_id order by created_at) as prox,
    lead(created_at) over (partition by contact_id order by created_at) - created_at as espera
  from msgs
),
ultima as (
  select distinct on (contact_id) contact_id, sender, created_at
  from msgs
  order by contact_id, created_at desc
)
select metrica, detalhe, valor from (

  select 1 as ord, 'empresa analisada' as metrica,
         (select name from alvo) as detalhe, '' as valor

  union all
  select 2, 'total de mensagens', '', count(*)::text from msgs

  union all
  select 3, 'contatos com conversa', '', count(distinct contact_id)::text from msgs

  union all
  select 4, 'periodo', to_char(min(created_at), 'DD/MM/YYYY'),
         'ate ' || to_char(max(created_at), 'DD/MM/YYYY') from msgs

  -- lead x atendimento x IA
  union all
  select 5, 'mensagens por remetente', sender, count(*)::text
  from msgs group by sender

  -- 'echo' = enviada pelo celular, 'history_sync' = importada, 'crm' = pelo sistema
  union all
  select 6, 'origem do que saiu', coalesce(metadata ->> 'source', 'crm'), count(*)::text
  from msgs where sender in ('user', 'ai')
  group by coalesce(metadata ->> 'source', 'crm')

  -- quanto tempo o lead espera até alguem responder (ignora esperas > 48h)
  union all
  select 7, 'resposta ao lead: ' || prox,
         'mediana ' || round((percentile_cont(0.5) within group (
           order by extract(epoch from espera) / 60))::numeric, 1)::text || ' min',
         count(*)::text || ' respostas'
  from pares
  where sender = 'contact' and prox in ('user', 'ai') and espera < interval '48 hours'
  group by prox

  union all
  select 8, 'leads aguardando resposta', 'ultima mensagem e do lead',
         count(*)::text from ultima where sender = 'contact'

  union all
  select 9, 'leads aguardando resposta', 'destes, nos ultimos 7 dias',
         count(*)::text from ultima
  where sender = 'contact' and created_at > now() - interval '7 days'

  union all
  select 10, 'contatos por etapa', coalesce(s.name, ct.stage), count(*)::text
  from public.contacts ct
  join alvo a on ct.company_id = a.id
  left join public.pipeline_stages s on s.company_id = ct.company_id and s.key = ct.stage
  group by coalesce(s.name, ct.stage)

  union all
  select 11, 'status de entrega', coalesce(metadata ->> 'deliveryStatus', '(sem status)'),
         count(*)::text
  from msgs where sender in ('user', 'ai')
  group by coalesce(metadata ->> 'deliveryStatus', '(sem status)')

) t
order by ord, valor desc, detalhe;
