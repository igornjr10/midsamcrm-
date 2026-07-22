-- Tarefas/Agenda — opcionalmente vinculadas a um contato.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_user_due on public.tasks(user_id, due_at);
create index idx_tasks_contact on public.tasks(contact_id) where contact_id is not null;

alter table public.tasks enable row level security;

create policy "own tasks" on public.tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger update_tasks_updated_at
  before update on public.tasks
  for each row execute function public.update_updated_at_column();
