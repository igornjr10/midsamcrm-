-- Conteúdo das conversas, para escrever o prompt do SDR IA.
--
-- Cole no SQL Editor, rode, e use Export > CSV. Nome, telefone e id do contato
-- NÃO saem: cada conversa vira um número. O que sai é quem falou, quando e o
-- texto — que é o material necessário para a IA aprender o tom certo.
--
-- Arquivo descartável de diagnóstico; pode apagar depois.

with alvo as (
  select id from public.companies
  order by (name ilike '%midsam%') desc, created_at
  limit 1
),
msgs as (
  select c.contact_id, c.sender, c.content, c.created_at
  from public.conversations c
  join alvo a on c.company_id = a.id
  where coalesce(c.content, '') <> ''
),
-- Só conversas de mão dupla: o lead falou e alguém respondeu. Thread de um
-- lado só não ensina nada sobre como responder.
elegiveis as (
  select contact_id
  from msgs
  group by contact_id
  having count(*) filter (where sender = 'contact') >= 1
     and count(*) filter (where sender in ('user', 'ai')) >= 1
  order by count(*) desc
  limit 60
)
select
  dense_rank() over (order by m.contact_id) as conversa,
  to_char(m.created_at, 'DD/MM HH24:MI') as quando,
  case m.sender when 'contact' then 'LEAD' when 'ai' then 'IA' else 'ATENDENTE' end as quem,
  left(m.content, 500) as texto
from msgs m
join elegiveis e on e.contact_id = m.contact_id
order by conversa, m.created_at
limit 900;


-- ── Extra 1: como o lead abre a conversa ────────────────────────────────────
-- A primeira mensagem de cada lead. Mostra o que eles perguntam de cara —
-- é isso que a IA vai receber e precisar responder bem.
/*
with alvo as (
  select id from public.companies
  order by (name ilike '%midsam%') desc, created_at limit 1
)
select distinct on (c.contact_id)
  left(c.content, 300) as primeira_mensagem_do_lead,
  to_char(c.created_at, 'DD/MM HH24:MI') as quando
from public.conversations c
join alvo a on c.company_id = a.id
where c.sender = 'contact' and coalesce(c.content, '') <> ''
order by c.contact_id, c.created_at
limit 200;
*/

-- ── Extra 2: as respostas que o time mais repete ────────────────────────────
-- Frases que se repetem são script pronto: viram regra no prompt da IA.
/*
with alvo as (
  select id from public.companies
  order by (name ilike '%midsam%') desc, created_at limit 1
)
select left(c.content, 160) as resposta_do_atendente, count(*) as vezes
from public.conversations c
join alvo a on c.company_id = a.id
where c.sender = 'user' and coalesce(c.content, '') <> ''
group by left(c.content, 160)
having count(*) > 1
order by vezes desc
limit 60;
*/
