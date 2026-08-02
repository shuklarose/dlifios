-- 02_new_user_trigger.sql - auto-create a profiles row on signup.
-- Run this AFTER schema.sql, in the Supabase SQL Editor.
--
-- The problem it solves: Supabase Auth writes to its own private auth.users table
-- when someone signs up (magic link). Our signup FORM fields (name, org, sector…)
-- ride along in that row's raw_user_meta_data. We want them copied into our own
-- public.profiles table automatically, the instant the auth user is created -
-- so the app (and the welcome-email webhook) always has a profile to read.
--
-- We do it with a database TRIGGER: "after any insert on auth.users, run this
-- function." The database guarantees it fires - no app code can forget to.

-- ---------------------------------------------------------------------------
-- The function the trigger runs. `new` is the freshly-inserted auth.users row.
--
--   security definer  → the function runs with the OWNER's rights, not the
--                       caller's, so it can insert into public.profiles even
--                       though the signing-up user has no direct write grant.
--   set search_path='' → hardening: with an empty search path we must write
--                       fully-qualified names (public.profiles, auth.users),
--                       which stops a hijacked search_path from redirecting the
--                       insert to a malicious table. This is Supabase's
--                       recommended pattern for security-definer functions.
--
-- raw_user_meta_data is JSONB; `->>'key'` reads a text value out of it. The
-- optional fields are simply NULL if the form didn't send them. full_name is
-- NOT NULL in our schema, so we coalesce to the email's local part as a safety
-- net - a metadata-less signup then still succeeds instead of erroring.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, org, employee_count, sector, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'org',
    new.raw_user_meta_data ->> 'employee_count',
    new.raw_user_meta_data ->> 'sector',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

-- Wire the function to the event. One row per signup, after it lands.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
