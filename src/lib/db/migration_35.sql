-- KlinikAid Migration 35: profiles.role cannot drift from the assigned role (#73)
--
-- profiles.role is the legacy role text column. Authorization does not read it:
-- every permission check resolves through profiles.role_id -> role_permissions,
-- and the department routes now scope by permissions too (this branch). It is
-- still read by the post-login redirect in src/middleware.ts and by a few page
-- guards, so a stale value sends a user to the wrong dashboard.
--
-- The two application paths that assign a role (/api/admin/staff POST and
-- /api/admin/staff/[id] PUT) write role and role_id in the same UPDATE, and
-- both derive role as `is_system ? name : base_role`. Nothing in the app can
-- write one without the other. The column can still drift through any other
-- writer: direct SQL, a future endpoint, or a script. Production has one such
-- row (a profile whose role_id points at a custom role while role still says
-- the value it had before the assignment).
--
-- This migration makes the relationship an invariant instead of a convention:
--
--   sync_profile_legacy_role()
--     A BEFORE INSERT OR UPDATE OF role_id trigger on profiles that rewrites
--     NEW.role from the assigned role: base_role for a custom role, the role's
--     own name for a system role (system roles keep their legacy name in
--     `name`, with base_role null). A custom role with a null base_role has no
--     derivable legacy value, so its profiles are left untouched rather than
--     writing a custom role name into a column the app compares to fixed
--     role names.
--
--     SECURITY DEFINER with an empty search_path: the trigger reads public.roles
--     regardless of the caller's RLS on that table, and cannot be pointed at a
--     shadowing schema. It is a trigger function, so it is not callable over
--     PostgREST even though EXECUTE keeps its default grant.
--
--     The trigger fires on INSERT as well so a future provisioning path cannot
--     create drift, and on UPDATE OF role_id only, so the ordinary profile
--     updates (privacy consent, email verification) pay nothing.
--
--   Backfill
--     Corrects every existing row whose role disagrees with its assigned role.
--     On production at the time of writing this is one profile; the update is
--     written set-wise so it also repairs any drift introduced since.
--
-- ORDERING: independent of the application deploy. The app already writes the
-- same value the trigger derives, so applying this before or after the branch
-- changes nothing for it. No app code calls anything this migration adds.
--
-- ROLLBACK
--   drop trigger if exists profiles_sync_legacy_role on public.profiles;
--   drop function if exists public.sync_profile_legacy_role();
--   The backfill is not reversed: it only replaced stale values with the value
--   the assigned role already implied.

begin;

create or replace function public.sync_profile_legacy_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
begin
  if new.role_id is null then
    return new;
  end if;

  select * into v_role
  from public.roles r
  where r.id = new.role_id;

  -- A missing role id is the foreign key's problem, not this trigger's.
  if not found then
    return new;
  end if;

  if v_role.base_role is not null then
    new.role := v_role.base_role;
  elsif v_role.is_system then
    new.role := v_role.name;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_role on public.profiles;

create trigger profiles_sync_legacy_role
  before insert or update of role_id on public.profiles
  for each row
  execute function public.sync_profile_legacy_role();

-- System roles: the legacy value is the role name itself.
update public.profiles p
   set role = r.name
  from public.roles r
 where p.role_id = r.id
   and r.is_system
   and p.role is distinct from r.name;

-- Custom roles: the legacy value is the base role.
update public.profiles p
   set role = r.base_role
  from public.roles r
 where p.role_id = r.id
   and not r.is_system
   and r.base_role is not null
   and p.role is distinct from r.base_role;

commit;
