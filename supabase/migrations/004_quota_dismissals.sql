-- Additive/idempotent. Requires 003 (ai_usage table). Back up before running.
begin;
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
commit;
