-- Run this once if schema.sql was already applied before login_id support.

alter table if exists public.opportunity_students
  add column if not exists login_id text not null default 'demo_student';

alter table if exists public.opportunity_categorization_runs
  add column if not exists login_id text not null default 'demo_student';

create index if not exists idx_opp_students_login_id on public.opportunity_students (login_id);
create index if not exists idx_opp_runs_login_id on public.opportunity_categorization_runs (login_id);
