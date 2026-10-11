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
