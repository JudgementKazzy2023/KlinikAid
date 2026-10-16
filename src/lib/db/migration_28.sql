-- KlinikAid Migration 28: a deactivated profile holds no permissions (#42)
--
-- Deactivation sets profiles.is_active = false and revokes refresh sessions, but
-- an access token already issued stays valid until it expires. Authorization
-- therefore has to read is_active itself rather than rely on the session ending.
--
-- Every role-based RLS check goes through one of three functions, and each now
-- requires an active profile, on top of migration_25's second-factor check:
--   user_has_permission()  -> false
--   get_auth_user_role()   -> null
--   get_auth_user_dept()   -> null
-- Own-row policies (auth.uid() = id) are unchanged, so a deactivated user can
-- still read its own profile, which is how the dashboard layout recognises the
-- account and redirects to /login?error=account_deactivated.
--
-- ORDERING: none. Nothing relies on an inactive profile holding permissions.
--
-- ROLLBACK: re-run the three function definitions from migration_25.

begin;

create or replace function public.user_has_permission(p_user_id uuid, p_permission_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_permission boolean;
begin
  if not public.auth_session_satisfies_mfa() then
    return false;
  end if;

  -- Callers (policies, the app, archive_specialist_patient) only ever ask about
  -- the session user; only service_role may ask about someone else.
  if p_user_id is distinct from auth.uid()
     and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on pr.role_id = rp.role_id
    join public.permissions pe on rp.permission_id = pe.id
    where pr.id = p_user_id and pr.is_active and pe.name = p_permission_name
  ) into v_has_permission;

  return coalesce(v_has_permission, false);
end;
$$;

create or replace function public.get_auth_user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = auth.uid() and is_active and public.auth_session_satisfies_mfa();
$$;

create or replace function public.get_auth_user_dept()
returns text
language sql
security definer
set search_path = public
as $$
  select department from public.profiles
  where id = auth.uid() and is_active and public.auth_session_satisfies_mfa();
$$;

commit;
