-- A lista de contatos escuta mudanças em tempo real (useContactsQuery), mas só
-- conversations tinha sido publicada (0004). Sem isso, lead novo só aparecia na
-- lista depois de recarregar a página.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
  ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end $$;
