-- Nicho e consumo na lista de Empresas.
--
-- A 0042 e a 0044 deram nicho e cota a cada empresa, mas deixaram as duas
-- informações escondidas atrás de um diálogo. O diretor abre a tela justamente
-- para comparar as empresas entre si — e via sete linhas iguais.
--
-- Uma function em vez de sete chamadas de company_usage: a tela lista todas as
-- empresas de uma vez, e uma consulta por linha multiplicaria o tempo de
-- abertura pelo número de clientes.
create or replace function public.companies_overview()
returns table (
  company_id uuid,
  niche_key text,
  niche_name text,
  monthly_coins int,
  allow_overage boolean,
  used numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.niche_key,
    n.name,
    p.monthly_coins,
    p.allow_overage,
    coalesce((
      select sum(e.coins)
      from public.usage_events e
      where e.company_id = c.id
        and e.created_at >= date_trunc('month', now())
    ), 0)
  from public.companies c
  left join public.niches n on n.key = c.niche_key
  left join public.company_plans p on p.company_id = c.id
  -- Só o super admin: é a régua comercial da plataforma inteira.
  where public.is_super_admin();
$$;

grant execute on function public.companies_overview() to authenticated;

notify pgrst, 'reload schema';
