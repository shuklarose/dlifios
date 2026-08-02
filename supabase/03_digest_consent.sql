-- Records whether a user opted in to the weekly digest.
-- Run after 02_new_user_trigger.sql.
--
-- The privacy policy names consent (GDPR Art. 6(1)(a)) as the basis for sending
-- the digest, and consent has to be a recorded, affirmative act rather than an
-- assumption. Without somewhere to store it, that claim was unbacked.
--
-- Defaults to false: Art. 4(11) requires a "clear affirmative action", so a
-- pre-ticked box or an opt-out default would not be valid consent.

alter table public.profiles
  add column if not exists digest_opt_in boolean not null default false;

-- When consent was given, which Art. 7(1) requires us to be able to demonstrate.
alter table public.profiles
  add column if not exists digest_opt_in_at timestamptz;

-- The digest job reads this to build its recipient list, so it is worth an index.
create index if not exists profiles_digest_opt_in_idx
  on public.profiles (digest_opt_in)
  where digest_opt_in;

-- Extend the signup trigger to carry the checkbox through from the form.
-- Replaces the function defined in 02_new_user_trigger.sql; the trigger itself
-- is unchanged and keeps pointing at this name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  opted boolean;
begin
  -- raw_user_meta_data is JSONB from the signup form. Anything other than a
  -- literal true is treated as no consent.
  opted := coalesce((new.raw_user_meta_data ->> 'digest_opt_in')::boolean, false);

  insert into public.profiles (
    id, email, full_name, org, employee_count, sector, phone,
    digest_opt_in, digest_opt_in_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'org',
    new.raw_user_meta_data ->> 'employee_count',
    new.raw_user_meta_data ->> 'sector',
    new.raw_user_meta_data ->> 'phone',
    opted,
    case when opted then now() else null end
  );
  return new;
end;
$$;
