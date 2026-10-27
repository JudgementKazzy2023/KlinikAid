-- KlinikAid Migration 46: patients can update their own profile again
--
-- Why: every patient update of their own `profiles` row fails with
--   ERROR: infinite recursion detected in policy for relation "profiles"
-- so a new patient cannot record the RA 10173 privacy consent: web's
-- privacy-agreement action and the mobile registration/consent screen both
-- update `accepted_privacy_at` with the patient's own session. Found on a real
-- Android device on 2026-10-27; reproduced in an in-process Postgres for the
-- definitions through migration 42 and for migration 43 alike.
--
-- Cause: "Users can update own profile details" (cd5ac56, 2026-10-02) guards
-- the protected columns with WITH CHECK sub-selects on `profiles` itself.
-- Postgres refuses a policy whose expression reads the table it protects:
-- expanding that sub-select applies the `profiles` policies again.
--
-- What this changes:
--   * The policy keeps its USING (own row, active account) and its WITH CHECK
--     becomes `(select auth.uid()) = id` only: no sub-select, no recursion.
--   * protect_profile_columns(), a BEFORE UPDATE trigger, keeps the same
--     guarantee the sub-selects gave: a patient (or any non-admin session)
--     cannot change role, role_id, department, is_active or email_verified_at.
--     It compares NEW with OLD, which a trigger can do without reading the
--     table. Allowed to change them, as before:
--       - holders of `profiles.manage` (the admin update policy);
--       - service_role and other trusted roles (server code, edge functions);
--       - SECURITY DEFINER database functions such as sync_email_verified_at,
--         which run as the function owner, not as the caller.
--   The function is SECURITY INVOKER on purpose: `current_user` must be the
--   caller's role for the trusted-role check to mean anything.
--
-- Trigger order: BEFORE triggers on a table run in name order, so the existing
-- profiles_sync_legacy_role (role text from role_id) runs before this guard.
--
-- ORDERING: independent of every pending migration; apply as soon as possible.
-- Web and mobile need no code change; the failing update starts to succeed.
-- SNAPSHOT: written but not applied; regenerate schema.sql after applying.
-- ROLLBACK (restores the recursion, so only if this breaks something else):
--   begin;
--   drop trigger if exists protect_profile_columns on public.profiles;
--   drop function if exists public.protect_profile_columns();
--   -- then re-create "Users can update own profile details" from migration_43.sql
--   commit;

begin;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.role, new.role_id, new.department, new.is_active, new.email_verified_at)
     is not distinct from
     (old.role, old.role_id, old.department, old.is_active, old.email_verified_at) then
    return new;
  end if;

  -- Server code and SECURITY DEFINER functions are not end-user sessions.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The admin path the "profiles.manage" update policy already allows.
  if public.user_has_permission(auth.uid(), 'profiles.manage') then
    return new;
  end if;

  raise exception 'Role, department, account status and email verification can only be changed by an administrator.'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profile_columns() from public, anon;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

drop policy if exists "Users can update own profile details" on public.profiles;
create policy "Users can update own profile details" on public.profiles
  for update
  to authenticated
  using ((((select auth.uid()) = id) and (is_active is true)))
  with check (((select auth.uid()) = id));

commit;
