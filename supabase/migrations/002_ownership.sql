-- Safe, idempotent migration for databases created with the original schema.sql. Runs in one transaction.
begin;
do $$ declare bad int; begin
  -- Applications linked to someone else's opportunity: keep the application, drop only the invalid link.
  update applications a set opportunity_id = null
   where opportunity_id is not null and not exists (select 1 from opportunities o where o.id=a.opportunity_id and o.user_id=a.user_id);
  get diagnostics bad = row_count; if bad > 0 then raise notice 'Cleared % cross-user opportunity link(s) on applications', bad; end if;
  -- Tasks pointing at someone else's analysis cannot be repaired automatically: stop and let a human decide.
  select count(*) into bad from learning_tasks t where not exists (select 1 from skill_analyses s where s.id=t.analysis_id and s.user_id=t.user_id);
  if bad > 0 then raise exception 'Migration aborted: % learning_tasks reference another user''s skill_analyses. Inspect and fix them, then re-run.', bad; end if;
  if not exists (select 1 from pg_constraint where conname='opportunities_id_user_key') then alter table opportunities add constraint opportunities_id_user_key unique (id, user_id); end if;
  if not exists (select 1 from pg_constraint where conname='skill_analyses_id_user_key') then alter table skill_analyses add constraint skill_analyses_id_user_key unique (id, user_id); end if;
  alter table applications drop constraint if exists applications_opportunity_id_fkey;
  alter table learning_tasks drop constraint if exists learning_tasks_analysis_id_fkey;
  if not exists (select 1 from pg_constraint where conname='applications_opportunity_owner_fkey') then
    alter table applications add constraint applications_opportunity_owner_fkey foreign key (opportunity_id, user_id) references opportunities(id, user_id) on delete set null (opportunity_id); end if;
  if not exists (select 1 from pg_constraint where conname='learning_tasks_analysis_owner_fkey') then
    alter table learning_tasks add constraint learning_tasks_analysis_owner_fkey foreign key (analysis_id, user_id) references skill_analyses(id, user_id) on delete cascade; end if;
end $$;
create index if not exists applications_opportunity_owner_idx on applications(opportunity_id, user_id);
create index if not exists applications_user_deadline_idx on applications(user_id, deadline);
create index if not exists learning_tasks_analysis_owner_idx on learning_tasks(analysis_id, user_id);
-- Re-assert RLS (idempotent).
do $$ declare t text; begin
  foreach t in array array['opportunities','applications','skill_analyses','learning_tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('create policy "own rows" on %I for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id)', t);
  end loop; end $$;
commit;
