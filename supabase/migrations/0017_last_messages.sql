-- Última mensagem por contato — prévia e ordenação da lista de conversas.
--
-- Antes o front lia as 1000 conversas mais recentes da empresa e reduzia no
-- cliente. Passando desse volume, os contatos cuja última mensagem caía fora da
-- janela ficavam sem prévia e desciam para o fim da lista. Paginar a tabela
-- inteira só para pegar uma linha por contato seria pior: são todas as
-- mensagens da empresa trafegando a cada carregamento do chat.
--
-- `distinct on (contact_id)` resolve no banco: uma linha por contato, a mais
-- recente, usando o índice idx_conversations_contact (contact_id, created_at).
--
-- security invoker (padrão): a policy "company conversations" continua valendo,
-- então passar o id de outra empresa não devolve nada.
create or replace function public.last_messages_by_contact(p_company_id uuid)
returns setof public.conversations
language sql
stable
set search_path = public
as $$
  select distinct on (contact_id) *
  from public.conversations
  where company_id = p_company_id
  order by contact_id, created_at desc, id desc;
$$;

grant execute on function public.last_messages_by_contact(uuid) to authenticated, service_role;
