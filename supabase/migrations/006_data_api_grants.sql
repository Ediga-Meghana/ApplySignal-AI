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
