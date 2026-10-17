-- KlinikAid Migration 29: email_verified_at records an actual confirmation (#67)
--
-- Patient accounts are now created unconfirmed and Auth refuses their password
-- sign-in until the emailed link is opened. When Auth sets
-- auth.users.email_confirmed_at, this trigger copies it to
-- profiles.email_verified_at, so the column means "the address was confirmed"
-- whichever way the confirmation happened (signup link, recovery link).
--
-- Only the null -> set transition counts. Accounts created already confirmed
-- (staff via admin, and every account from before this change) keep whatever
-- email_verified_at they had; nothing here backfills it.
--
-- The own-row update policy also stops a user writing email_verified_at, which
-- they could until now. Staff with profiles.manage are unaffected.
--
-- ORDERING: independent of the app change. The sign-in gate is Auth's
-- email_confirmed_at, not this column; without the migration the column just
-- stays null for newly confirmed accounts.
--
-- ROLLBACK
--   drop trigger if exists on_auth_user_email_confirmed on auth.users;
--   drop function if exists public.sync_email_verified_at();
--   and re-create "Users can update own profile details" from migration_19.sql.

begin;

create or replace function public.sync_email_verified_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email_verified_at = new.email_confirmed_at
   where id = new.id
     and email_verified_at is null;
  return new;
end;
$$;

revoke all on function public.sync_email_verified_at() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.sync_email_verified_at();

drop policy if exists "Users can update own profile details" on public.profiles;
create policy "Users can update own profile details"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- IS NOT DISTINCT FROM, not =, so a NULL held by a NULL-holder stays legal
    -- while a change from NULL to a real value is still blocked.
    and role              is not distinct from (select p.role              from public.profiles p where p.id = auth.uid())
    and role_id           is not distinct from (select p.role_id           from public.profiles p where p.id = auth.uid())
    and department        is not distinct from (select p.department        from public.profiles p where p.id = auth.uid())
    and is_active         is not distinct from (select p.is_active         from public.profiles p where p.id = auth.uid())
    and email_verified_at is not distinct from (select p.email_verified_at from public.profiles p where p.id = auth.uid())
  );

commit;
