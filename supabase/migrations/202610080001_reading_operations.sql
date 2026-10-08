-- Run once in Supabase SQL Editor. Safe to rerun for this app's table/policies.
-- No public access: an authenticated user can only read/append their own operations.
begin;
create table if not exists public.reading_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text collate "C" not null check (id ~ '^[a-zA-Z0-9-]{1,80}$'),
  payload text not null check (
    octet_length(payload) <= 950000
    and jsonb_typeof(payload::jsonb) = 'object'
    and (payload::jsonb ?& array['id','at','url','kind','patch'])
    and jsonb_typeof(payload::jsonb->'id') = 'string'
    and payload::jsonb->>'id' = id
    and jsonb_typeof(payload::jsonb->'at') = 'number'
    and (payload::jsonb->>'at')::numeric >= 0
    and jsonb_typeof(payload::jsonb->'kind') = 'string'
    and payload::jsonb->>'kind' in ('create','patch','delete')
    and jsonb_typeof(payload::jsonb->'patch') = 'object'
    and jsonb_typeof(payload::jsonb->'url') = 'string'
    and payload::jsonb->>'url' ~ '^https?://'
  ),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.reading_operations enable row level security;
alter table public.reading_operations force row level security;
revoke all on table public.reading_operations from anon, authenticated;
grant select, insert on table public.reading_operations to authenticated;
drop policy if exists reading_operations_select_own on public.reading_operations;
create policy reading_operations_select_own on public.reading_operations
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists reading_operations_insert_own on public.reading_operations;
create policy reading_operations_insert_own on public.reading_operations
  for insert to authenticated with check ((select auth.uid()) = user_id);
commit;
