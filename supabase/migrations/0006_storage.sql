-- Bucket publico para midia recebida/enviada no chat (imagens, documentos).
-- Caminho: {user_id}/{message_id}.{ext}

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

create policy "chat-media owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "chat-media public read"
  on storage.objects for select
  using (bucket_id = 'chat-media');
