-- FRESH databases only (run this ONE file; do not also run migrations). Existing databases: run the migrations listed in README section 2.
-- Every table is owned by auth.uid(), protected by RLS, and child rows must share their parent's owner (composite FKs).
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text, role text, type text, action text, url text, source text,
  deadline date, assessment_date date, interview_date date, snippet text,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opportunity_id uuid,
  company text not null check (length(trim(company))>0),
  role text not null check (length(trim(role))>0),
  type text, url text, source text, notes text,
  status text not null default 'Saved' check (status in ('Saved','Applied','Assessment','Interview','Offer','Rejected')),
  deadline date, assessment_date date, interview_date date, follow_up_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (opportunity_id, user_id) references opportunities(id, user_id) on delete set null (opportunity_id)
);
create table skill_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_role text, job_description text, matched text[] not null default '{}', missing text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table learning_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  analysis_id uuid not null,
  title text not null, done boolean not null default false, created_at timestamptz not null default now(),
  foreign key (analysis_id, user_id) references skill_analyses(id, user_id) on delete cascade
);
create index on opportunities(user_id); create index on applications(user_id, status);
create index on skill_analyses(user_id); create index on learning_tasks(analysis_id, user_id); create index on applications(opportunity_id, user_id); create index on applications(user_id, deadline);
do $$ declare t text; begin
  foreach t in array array['opportunities','applications','skill_analyses','learning_tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "own rows" on %I for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id)', t);
  end loop; end $$;

-- ===== 003: AI metadata, profiles, AI rate-limit ledger =====
-- Additive and idempotent: no data is dropped or rewritten. Back up before running anyway.
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

-- ===== 004: reminder dismissals + atomic AI quota =====
-- Additive/idempotent. Requires 003 (ai_usage table). Back up before running.
create table if not exists reminder_dismissals (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (length(key) between 1 and 300), created_at timestamptz not null default now(), primary key (user_id, key));
alter table reminder_dismissals enable row level security;
drop policy if exists "own rows" on reminder_dismissals;
create policy "own rows" on reminder_dismissals for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
-- Atomic quota check+consume. The per-user advisory lock serialises concurrent calls, so parallel requests cannot all pass the check.
create or replace function consume_ai_quota(p_user uuid, p_limit int, p_window interval default '1 hour') returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; begin
  if p_limit is null or p_limit < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select count(*) into n from ai_usage where user_id = p_user and created_at > now() - p_window;
  if n >= p_limit then return false; end if;
  insert into ai_usage(user_id) values (p_user); return true;
end $$;
revoke all on function consume_ai_quota(uuid, int, interval) from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function consume_ai_quota(uuid,int,interval) from %I', r); end if; end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function consume_ai_quota(uuid,int,interval) to service_role; end if;
end $$;


-- ===== 005: optional email reminders + Realtime =====
-- Additive migration: optional email reminders and user-scoped Supabase Realtime publication.
begin;
alter table profiles add column if not exists notify_email boolean not null default false;
alter table profiles add column if not exists timezone text not null default 'Asia/Kolkata';
create table if not exists notification_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_key text not null check (length(reminder_key) between 1 and 300),
  reminder_date date not null,
  channel text not null check (channel in ('email')),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  primary key (user_id, reminder_key, reminder_date, channel)
);
create index if not exists notification_deliveries_user_date_idx on notification_deliveries(user_id, reminder_date);
alter table notification_deliveries enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then execute 'revoke all on notification_deliveries from anon'; end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then execute 'revoke all on notification_deliveries from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname='service_role') then execute 'grant select, insert, update on notification_deliveries to service_role'; end if;
end $$;
-- Intentionally no client policies: only the server-side service role can read/write delivery state.
-- Add user-owned tables to Realtime when the standard Supabase publication exists. This is idempotent.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['applications','opportunities','skill_analyses','learning_tasks','profiles','reminder_dismissals'] loop
      if to_regclass(format('public.%I', t)) is not null and not exists (
        select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      if to_regclass(format('public.%I', t)) is not null then execute format('alter table public.%I replica identity full', t); end if;
    end loop;
  end if;
end $$;
commit;


-- ===== 006: explicit Data API grants (same content as migrations/006_data_api_grants.sql) =====
-- 006: explicit Data API privileges (required by Supabase's 2026 "no automatic exposure" change).
-- Since 2026-05-30 new Supabase projects (and from 2026-10-30 all projects) do NOT auto-grant table access to
-- anon / authenticated / service_role. Without these GRANTs PostgREST cannot see the tables and the app shows
-- "Could not find the table 'public.<name>' in the schema cache" even though the table exists.
-- GRANT only opens the door to the API; Row Level Security (policies in 002-005) still decides which ROWS a user can touch.
-- Idempotent and additive: safe to run more than once. Requires 002-005 (or schema.sql) to have created the tables.
do $$
declare t text;
begin
  foreach t in array array['applications','opportunities','skill_analyses','learning_tasks','profiles','reminder_dismissals'] loop
    -- Signed-in users: full CRUD on their own rows (RLS "own rows" policies restrict which rows).
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- Server-side functions (send-reminders digest) read these tables with the service role.
    execute format('grant select on public.%I to service_role', t);
    -- The app has no anonymous features: signed-out visitors get no table access at all.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Server-only ledgers: nobody on the client side may touch them (RLS is on with no policies; this is defence in depth).
revoke all on public.ai_usage from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
do $$ begin
  if to_regclass('public.ai_usage_id_seq') is not null then execute 'revoke all on sequence public.ai_usage_id_seq from anon, authenticated'; end if;
end $$;
