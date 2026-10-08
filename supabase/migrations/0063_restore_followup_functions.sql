-- Reparo de drift: recria as duas funcoes do follow-up do SDR.
--
-- Sintoma em producao, na tela de cadencia do SDR IA:
--   Could not find the function public.save_followup_steps(p_company_id,
--   p_steps) in the schema cache
--
-- Isso e o PGRST202: o PostgREST nao acha a funcao. A assinatura que o front
-- chama bate exatamente com a da 0010, entao nao e divergencia de argumento --
-- a funcao nao esta no banco.
--
-- Como aconteceu: na virada de 2026-09-24 o projeto foi copiado para
-- dgoxrszrofnerbevuoyu, e a copia nao trouxe estas funcoes. O historico de
-- migrations diz que a 0010 e a 0032 rodaram, entao nenhuma delas roda de
-- novo sozinha -- e o buraco fica de pe ate alguem recria-las.
--
-- Mesmo remedio da 0031, que tratou o drift irmao (as tabelas tinham sumido e
-- as funcoes tinham ficado; aqui e o contrario). Definicoes copiadas das
-- versoes finais -- save_followup_steps da 0010, followup_candidates da 0032.
-- `create or replace` em cima de uma funcao identica e no-op, entao em
-- qualquer banco onde elas ja existem esta migration nao muda nada.

-- ── Grava a cadencia inteira (a tela manda todos os passos de uma vez) ─────
create or replace function public.save_followup_steps(p_company_id uuid, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (p_company_id in (select public.my_company_ids()) or public.is_super_admin()) then
    raise exception 'Sem permissão para esta empresa';
  end if;

  delete from public.followup_steps where company_id = p_company_id;

  insert into public.followup_steps (
    company_id, step_order, delay_hours, kind, message,
    template_name, template_language, template_body, variable_map, active
  )
  select
    p_company_id,
    t.idx::smallint,
    coalesce((t.s->>'delay_hours')::numeric, 24),
    coalesce(t.s->>'kind', 'text'),
    nullif(t.s->>'message', ''),
    nullif(t.s->>'template_name', ''),
    coalesce(nullif(t.s->>'template_language', ''), 'pt_BR'),
    nullif(t.s->>'template_body', ''),
    coalesce(nullif(t.s->'variable_map', 'null'::jsonb), '{}'::jsonb),
    coalesce((t.s->>'active')::boolean, true)
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as t(s, idx);
end;
$$;

grant execute on function public.save_followup_steps(uuid, jsonb) to authenticated, service_role;

-- ── Quem esta esperando o proximo passo do follow-up ──────────────────────
create or replace function public.followup_candidates(
  p_company_id uuid,
  p_open_only boolean default true,
  p_limit integer default 200
)
returns table (
  contact_id uuid,
  name text,
  phone text,
  email text,
  stage text,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_followup_at timestamptz,
  followups_done integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone,
    c.email,
    c.stage,
    m.last_inbound_at,
    m.last_message_at,
    f.last_followup_at,
    coalesce(f.done, 0)::integer
  from public.contacts c
  join lateral (
    select
      max(v.created_at) filter (where v.sender = 'contact') as last_inbound_at,
      max(v.created_at) as last_message_at
    from public.conversations v
    where v.contact_id = c.id
  ) m on true
  left join lateral (
    select max(l.created_at) as last_followup_at, count(*) as done
    from public.followup_logs l
    where l.contact_id = c.id
      and (m.last_inbound_at is null or l.created_at > m.last_inbound_at)
  ) f on true
  left join public.pipeline_stages s
    on s.company_id = c.company_id and s.key = c.stage
  where c.company_id = p_company_id
    and c.ai_paused = false
    and nullif(trim(c.phone), '') is not null
    and m.last_message_at is not null
    and (not p_open_only or coalesce(s.kind, 'open') = 'open')
  order by m.last_message_at asc
  limit p_limit;
$$;

grant execute on function public.followup_candidates(uuid, boolean, integer) to service_role;

-- Sem isto o PostgREST so enxerga as funcoes no proximo restart, e a tela
-- continua dando PGRST202 mesmo com elas ja criadas.
notify pgrst, 'reload schema';
