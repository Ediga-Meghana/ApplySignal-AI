-- Run in Supabase SQL editor. Every table is owned by auth.uid() and protected by RLS.
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text, role text, type text, action text, url text, source text,
  deadline date, assessment_date date, interview_date date, snippet text,
  created_at timestamptz not null default now()
);
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete set null,
  company text not null check (length(trim(company))>0),
  role text not null check (length(trim(role))>0),
  type text, url text, source text, notes text,
  status text not null default 'Saved' check (status in ('Saved','Applied','Assessment','Interview','Offer','Rejected')),
  deadline date, assessment_date date, interview_date date, follow_up_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table skill_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_role text, job_description text, matched text[] not null default '{}', missing text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table learning_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  analysis_id uuid not null references skill_analyses(id) on delete cascade,
  title text not null, done boolean not null default false, created_at timestamptz not null default now()
);
create index on opportunities(user_id); create index on applications(user_id, status);
create index on skill_analyses(user_id); create index on learning_tasks(analysis_id);
do $$ declare t text; begin
  foreach t in array array['opportunities','applications','skill_analyses','learning_tasks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "own rows" on %I for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id)', t);
  end loop; end $$;
