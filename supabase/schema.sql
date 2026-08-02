-- DlíFios - accounts and usage logging.
-- Run this in the Supabase dashboard:  SQL Editor → New query → paste → Run.
-- It is idempotent-ish for a fresh project; re-running will error on existing
-- objects (that's fine - you only run it once per project).

-- ---------------------------------------------------------------------------
-- 1. profiles - one row per signed-up user.
--
-- Supabase Auth already keeps its own private table, auth.users, holding the
-- login identity (id + email + magic-link state). We DON'T touch that table.
-- Instead we keep our own public.profiles row, linked 1:1 by the same id, to
-- store the signup-form fields. `references auth.users(id) on delete cascade`
-- means: if the auth user is ever deleted, their profile row is deleted too -
-- no orphans.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid        primary key references auth.users(id) on delete cascade,
  email          text        not null,
  full_name      text        not null,               -- required at signup
  org            text,                                -- optional
  employee_count text,                                -- optional; TEXT so we can store ranges like "11-50"
  sector         text,                                -- optional
  phone          text,                                -- optional
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. question_log - one row per /ask call.
--
-- This is two things at once:
--   (a) the WALLET GUARD - the server counts a user's rows in a time window to
--       enforce the hard cap before spending a paid Gemini call.
--   (b) a dataset of real questions for retrieval evaluation.
--
-- user_id is nullable: a pre-signup (anonymous) question logs with NULL. If the
-- user is later deleted we keep the log row but null out the id
-- (on delete set null) - we lose the link, not the analytics.
-- ---------------------------------------------------------------------------
create table public.question_log (
  id         bigint      generated always as identity primary key,
  user_id    uuid        references auth.users(id) on delete set null,
  question   text        not null,
  created_at timestamptz not null default now()
);

-- Index the exact shape of the wallet-guard query ("rows for THIS user, recently"),
-- so the count stays fast as the log grows.
create index question_log_user_created_idx
  on public.question_log (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security (RLS).
--
-- Supabase exposes these tables over an auto-generated API. Two keys reach it:
--   • the ANON key  - shipped to the browser; requests run as the logged-in user.
--   • the SERVICE_ROLE key - lives only on our server; BYPASSES RLS entirely.
--
-- RLS is the firewall for the anon/browser path. Rule of thumb: enable RLS on
-- every public table, then add policies only for what the browser is allowed to
-- do. Anything with RLS on and no matching policy is denied.
-- ---------------------------------------------------------------------------

-- profiles: a user may read and edit ONLY their own row.
alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- question_log: RLS on, and DELIBERATELY no policies.
-- The browser never reads or writes this table directly - our server does, using
-- the service_role key, which skips RLS. So "no policy = locked shut" is exactly
-- what we want: users can't read each other's questions or forge log rows to dodge
-- the quota.
alter table public.question_log enable row level security;
