-- Agenda visível para o SDR IA.
--
-- Sem isto a IA confirma data para o lead sem saber se o dia já está tomado —
-- o mesmo tipo de erro do dia da semana: ela afirma o que não pode saber.
--
-- Devolve só o que interessa para dizer "esse dia está livre" ou "nesse dia já
-- temos evento": título, horários e status. Nada de contato ou observação.

create or replace function public.agenda_for_ai(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  title text,
  kind text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.starts_at, a.ends_at, a.all_day, a.title, a.kind
  from public.appointments a
  where a.company_id = p_company_id
    and a.status <> 'canceled'
    and a.starts_at >= p_from
    and a.starts_at < p_to
  order by a.starts_at
  limit 50;
$$;

grant execute on function public.agenda_for_ai(uuid, timestamptz, timestamptz) to service_role;
