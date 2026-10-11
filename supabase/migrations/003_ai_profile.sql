-- Additive and idempotent: no data is dropped or rewritten. Back up before running anyway.
begin;
alter table opportunities add column if not exists source_text text, add column if not exists extraction_method text check (extraction_method in ('ai','rules')),
  add column if not exists extracted_at timestamptz, add column if not exists details jsonb;
alter table skill_analyses add column if not exists method text check (method in ('ai','keywords')), add column if not exists result jsonb;
create table if not exists profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text, graduation_year int check (graduation_year between 1990 and 2100),
  skills text[] not null default '{}', preferred_roles text[] not null default '{}', preferred_locations text[] not null default '{}',
  notify_in_app boolean not null default true, updated_at timestamptz not null default now());
-- Rate-limit ledger for the AI Edge Function. RLS on with NO policies: only the service role (server) can touch it.
create table if not exists ai_usage (id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create index if not exists ai_usage_user_time_idx on ai_usage(user_id, created_at);
alter table profiles enable row level security; alter table ai_usage enable row level security;
drop policy if exists "own rows" on profiles;
create policy "own rows" on profiles for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
commit;
