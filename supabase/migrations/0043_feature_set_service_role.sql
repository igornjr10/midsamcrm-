-- company_feature_set precisa responder também para a chave de serviço.
--
-- A 0042 filtrou por my_company_ids()/is_super_admin(), que é o certo para o
-- browser — mas as edge functions chamam com service role, onde auth.uid() é
-- nulo. A function devolvia zero linhas, e o hasFeature, que trata "módulo
-- ausente do catálogo" como liberado, deixava tudo passar.
--
-- Ou seja: a checagem que existe justamente para impedir o uso do que não foi
-- comprado nunca teria negado nada — e do jeito mais perigoso, silenciosamente.
--
-- Não dá para "abrir" a function e resolver: qualquer autenticado passaria a
-- listar os módulos de qualquer empresa. O que muda é reconhecer o chamador de
-- serviço, que já é o dono do banco de qualquer forma.
create or replace function public.company_feature_set(p_company_id uuid)
returns table (feature_key text, label text, route text, core boolean, enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.key,
    f.label,
    f.route,
    f.core,
    case
      when f.core then true
      when cf.enabled is not null then cf.enabled
      when c.niche_key is null then true
      else nf.feature_key is not null
    end as enabled
  from public.features f
  cross join (select niche_key from public.companies where id = p_company_id) c
  left join public.company_features cf
    on cf.company_id = p_company_id and cf.feature_key = f.key
  left join public.niche_features nf
    on nf.niche_key = c.niche_key and nf.feature_key = f.key
  where
    p_company_id in (select public.my_company_ids())
    or public.is_super_admin()
    -- Chamador de serviço (edge function). Lido direto das claims em vez de
    -- auth.role() para não depender de um helper que muda entre versões.
    or coalesce(
         nullif(current_setting('request.jwt.claim.role', true), ''),
         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
       ) = 'service_role'
  order by f.position, f.label;
$$;

notify pgrst, 'reload schema';
