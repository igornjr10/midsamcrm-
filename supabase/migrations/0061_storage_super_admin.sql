-- Super admin na conta de um cliente não conseguia subir arquivo na Biblioteca.
--
-- As regras de escrita dos buckets library e menu-images exigem que o usuário
-- seja membro da empresa dona da pasta. O super admin entra na conta do cliente
-- sem ser membro (Empresas › Acessar), e o Storage recusava o upload — embora a
-- tabela library_items já aceitasse is_super_admin(). Aqui o Storage passa a
-- seguir a mesma regra da tabela.
--
-- As regras de menu-images não estavam em migration (foram criadas no painel);
-- ficam registradas aqui.

drop policy if exists "library company write" on storage.objects;
drop policy if exists "library company delete" on storage.objects;
drop policy if exists "menu-images company write" on storage.objects;
drop policy if exists "menu-images company update" on storage.objects;
drop policy if exists "menu-images company delete" on storage.objects;

create policy "library company write" on storage.objects for insert
  with check (
    bucket_id = 'library'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.company_id::text = (storage.foldername(name))[1]
      )
    )
  );

create policy "library company delete" on storage.objects for delete
  using (
    bucket_id = 'library'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.company_id::text = (storage.foldername(name))[1]
      )
    )
  );

create policy "menu-images company write" on storage.objects for insert
  with check (
    bucket_id = 'menu-images'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.company_id::text = (storage.foldername(name))[1]
      )
    )
  );

create policy "menu-images company update" on storage.objects for update
  using (
    bucket_id = 'menu-images'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.company_id::text = (storage.foldername(name))[1]
      )
    )
  );

create policy "menu-images company delete" on storage.objects for delete
  using (
    bucket_id = 'menu-images'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members m
        where m.user_id = auth.uid() and m.company_id::text = (storage.foldername(name))[1]
      )
    )
  );
