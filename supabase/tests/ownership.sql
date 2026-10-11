-- Run by run.sh as superuser first (creates users + helper), then as role `authenticated` per user.
\set A '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
create or replace function expect_fail(label text, q text) returns void language plpgsql as $$
begin begin execute q; exception when others then raise notice 'PASS (rejected: %)  %', sqlerrm, label; return; end;
  raise exception 'FAIL (was allowed): %', label; end $$;
create or replace function expect_rows(label text, q text, n int) returns void language plpgsql as $$
declare c int; begin execute 'select count(*) from ('||q||') x' into c; if c<>n then raise exception 'FAIL: % (got %, wanted %)', label, c, n; end if; raise notice 'PASS %', label; end $$;
create or replace function expect_affected(label text, q text, n int) returns void language plpgsql as $$
declare c int; begin execute q; get diagnostics c = row_count; if c<>n then raise exception 'FAIL: % (affected %, wanted %)', label, c, n; end if; raise notice 'PASS %', label; end $$;
reset role; select set_config('request.jwt.claim.sub', :A, false);
set role authenticated;
insert into opportunities(id,company,role) values ('11111111-1111-1111-1111-111111111111','Acme','Intern');
insert into skill_analyses(id,target_role) values ('22222222-2222-2222-2222-222222222222','SDE');
select set_config('request.jwt.claim.sub', :B, false);
select expect_fail('B cannot create application linked to A''s opportunity', $$insert into applications(company,role,opportunity_id) values ('X','Y','11111111-1111-1111-1111-111111111111')$$);
select expect_fail('B cannot create task linked to A''s analysis', $$insert into learning_tasks(analysis_id,title) values ('22222222-2222-2222-2222-222222222222','t')$$);
select expect_fail('B cannot insert a row owned by A', format($$insert into opportunities(user_id,company) values (%L,'x')$$, :A));
select expect_rows('B cannot read A''s rows', 'select 1 from opportunities', 0);
select expect_affected('B update of A''s row affects nothing', 'update opportunities set company=''hack''', 0);
select expect_affected('B delete of A''s row affects nothing', 'delete from skill_analyses', 0);
select set_config('request.jwt.claim.sub', :A, false);
select expect_rows('A still has own opportunity untouched', $$select 1 from opportunities where company='Acme'$$, 1);
insert into applications(id,company,role,opportunity_id) values ('33333333-3333-3333-3333-333333333333','Acme','Intern','11111111-1111-1111-1111-111111111111');
insert into learning_tasks(analysis_id,title) values ('22222222-2222-2222-2222-222222222222','learn sql');
select expect_fail('A cannot hand own application to B', format($$update applications set user_id=%L$$, :B));
delete from opportunities;
select expect_rows('deleting opportunity keeps application, nulls link', $$select 1 from applications where opportunity_id is null$$, 1);
delete from skill_analyses;
select expect_rows('deleting analysis cascades to tasks', 'select 1 from learning_tasks', 0);
-- profiles + ai_usage (migration 003)
select set_config('request.jwt.claim.sub', :A, false);
insert into profiles(full_name) values ('Alice');
select set_config('request.jwt.claim.sub', :B, false);
select expect_rows('B cannot read A''s profile', 'select 1 from profiles', 0);
select expect_fail('B cannot write a profile for A', format($$insert into profiles(user_id,full_name) values (%L,'x')$$, :A));
select expect_fail('authenticated users cannot write ai_usage (service role only)', format($$insert into ai_usage(user_id) values (%L)$$, :B));
select expect_fail('authenticated users cannot read ai_usage (privilege revoked)', 'select 1 from ai_usage');
select expect_fail('authenticated users cannot call consume_ai_quota', format($$select consume_ai_quota(%L, 5)$$, :B));
-- reminder_dismissals
select set_config('request.jwt.claim.sub', :A, false);
insert into reminder_dismissals(key) values ('application:1:Interview@2030-01-01');
select set_config('request.jwt.claim.sub', :B, false);
select expect_rows('B cannot read A''s dismissals', 'select 1 from reminder_dismissals', 0);
select expect_fail('B cannot write a dismissal for A', format($$insert into reminder_dismissals(user_id,key) values (%L,'k')$$, :A));

-- server-only notification delivery ledger (migration 005)
select expect_fail('authenticated users cannot read notification delivery ledger (privilege revoked)', 'select 1 from notification_deliveries');
select expect_fail('authenticated users cannot insert notification delivery ledger', $$insert into notification_deliveries(user_id,reminder_key,reminder_date,channel) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','k','2031-01-01','email')$$);

-- ===== 006: explicit Data API grants (privilege checks; run as superuser, so reset role first) =====
reset role;
create or replace function expect_priv(label text, who text, tbl text, priv text, want boolean) returns void language plpgsql as $$
declare got boolean; begin got := has_table_privilege(who, 'public.'||tbl, priv);
  if got is distinct from want then raise exception 'FAIL: % (% % on % = %, wanted %)', label, who, priv, tbl, got, want; end if;
  raise notice 'PASS %', label; end $$;
do $$ declare t text; p text; begin
  foreach t in array array['applications','opportunities','skill_analyses','learning_tasks','profiles','reminder_dismissals'] loop
    foreach p in array array['select','insert','update','delete'] loop
      perform expect_priv('authenticated has '||p||' on '||t, 'authenticated', t, p, true);
    end loop;
    perform expect_priv('anon has NO select on '||t, 'anon', t, 'select', false);
    perform expect_priv('anon has NO insert on '||t, 'anon', t, 'insert', false);
    perform expect_priv('service_role can select '||t||' (send-reminders)', 'service_role', t, 'select', true);
  end loop;
  foreach t in array array['ai_usage','notification_deliveries'] loop
    perform expect_priv('authenticated has NO select on server-only '||t, 'authenticated', t, 'select', false);
    perform expect_priv('authenticated has NO insert on server-only '||t, 'authenticated', t, 'insert', false);
    perform expect_priv('anon has NO select on server-only '||t, 'anon', t, 'select', false);
  end loop;
  perform expect_priv('service_role can insert notification_deliveries', 'service_role', 'notification_deliveries', 'insert', true);
  perform expect_priv('service_role can update notification_deliveries', 'service_role', 'notification_deliveries', 'update', true);
end $$;
