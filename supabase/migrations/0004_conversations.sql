-- Mensagens trocadas com cada contato (WhatsApp).
-- sender: 'user' = a conta enviou; 'contact' = mensagem recebida do cliente.
-- message_ref = wamid da Meta/Datafy, usado para dedupe e status de entrega.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  sender text not null check (sender in ('user', 'contact')),
  content text not null,
  channel text not null default 'whatsapp',
  message_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index conversations_user_message_ref_uniq
  on public.conversations(user_id, message_ref)
  where message_ref is not null;
create index idx_conversations_contact on public.conversations(contact_id, created_at);
create index idx_conversations_user_created on public.conversations(user_id, created_at desc);

alter table public.conversations enable row level security;

create policy "own conversations" on public.conversations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Chat ao vivo: front assina INSERTs desta tabela.
alter publication supabase_realtime add table public.conversations;
