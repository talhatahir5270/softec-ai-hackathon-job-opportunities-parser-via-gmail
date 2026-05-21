-- Opportunity Inbox Copilot — run once in Supabase: SQL Editor → New query → Run
-- Uses service role from the FastAPI backend only (never ship service keys to the browser).

create extension if not exists pgcrypto;

create table if not exists public.opportunity_students (
  id uuid primary key,
  login_id text not null,
  created_at timestamptz not null,
  degree text not null,
  semester int not null,
  cgpa double precision not null,
  skills jsonb not null default '[]'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  preferred_opportunity_types jsonb not null default '[]'::jsonb,
  location_preference jsonb not null default '[]'::jsonb,
  financial_need text not null,
  availability text not null,
  experience_level text not null
);

create table if not exists public.opportunity_emails (
  id text primary key,
  from_address text not null,
  subject text not null,
  date text,
  body text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunity_categorization_runs (
  id uuid primary key default gen_random_uuid(),
  login_id text not null,
  student_snapshot jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.opportunity_categorization_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.opportunity_categorization_runs (id) on delete cascade,
  email_id text not null references public.opportunity_emails (id) on delete cascade,
  is_opportunity boolean not null,
  opportunity_type text not null,
  relevance_score double precision not null,
  profile_fit_label text not null,
  rationale text not null
);

create index if not exists idx_opp_cat_items_run on public.opportunity_categorization_items (run_id);
create index if not exists idx_opp_cat_items_email on public.opportunity_categorization_items (email_id);
create index if not exists idx_opp_students_login_id on public.opportunity_students (login_id);
create index if not exists idx_opp_runs_login_id on public.opportunity_categorization_runs (login_id);
