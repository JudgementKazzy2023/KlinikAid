-- KlinikAid Migration 32: custom-role writes are one transaction (#44)
--
-- Editing a custom role used to be three separate requests: update the role
-- row, delete every role_permissions row for it, insert the replacement set.
-- When the insert failed (a permission id that no longer exists, or any
-- transient error) the delete had already committed, so every user holding the
-- role lost all of its permissions while the UI reported a failed update.
-- Creating a role had the same gap: the role row could commit without its
-- mappings.
--
-- create_custom_role() and update_custom_role() do the whole write in one
-- function call, so it commits completely or not at all. Every input is
-- validated before the first write: name length and uniqueness, the role
-- exists and is not a system role, the caller's own role is not the target,
-- and every permission id exists with no duplicates. update_custom_role()
-- locks the role row first, so two concurrent edits of the same role apply one
-- after the other and the result is exactly one of the two permission sets.
--
-- Both functions are SECURITY INVOKER. The existing "Role managers have full
-- access to ..." policies already allow a roles.manage holder each statement
-- here, and still apply to every statement in the function. The explicit
-- roles.manage check at the top gives a clear refusal rather than an RLS
-- filter that silently matches zero rows. A new custom role always gets
-- base_role 'receptionist', as the app did, and update never changes it.
--
-- Error messages are the ones the app shows to the user.
--
-- ORDERING: apply before deploying the app change that calls these functions.
-- This migration only adds functions; the old three-request code keeps
-- working against it.
--
-- ROLLBACK
--   drop function if exists public.update_custom_role(uuid, text, text, uuid[]);
--   drop function if exists public.create_custom_role(text, text, uuid[]);
--   drop function if exists public.validate_custom_role_input(uuid, text, uuid[]);
--   and redeploy the previous app version first, since it does not call them.

begin;

-- Shared input checks. Raises on the first problem; returns the trimmed name.
create or replace function public.validate_custom_role_input(
  p_role_id uuid,
  p_name text,
  p_permission_ids uuid[]
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_known integer;
begin
  if not public.user_has_permission(auth.uid(), 'roles.manage') then
    raise exception 'FORBIDDEN: Missing permission ''roles.manage''' using errcode = '42501';
  end if;

  if char_length(v_name) < 3 then
    raise exception 'Role name must be at least 3 characters.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.roles r
    where r.name = v_name
      and r.id is distinct from p_role_id
  ) then
    raise exception 'A role with this name already exists.' using errcode = '23505';
  end if;

  if p_permission_ids is null or array_position(p_permission_ids, null) is not null then
    raise exception 'One or more selected permissions do not exist.' using errcode = '22023';
  end if;

  if cardinality(p_permission_ids) <> (select count(distinct x) from unnest(p_permission_ids) x) then
    raise exception 'Each permission can only be selected once.' using errcode = '22023';
  end if;

  select count(*) into v_known
  from public.permissions pe
  where pe.id = any (p_permission_ids);

  if v_known <> cardinality(p_permission_ids) then
    raise exception 'One or more selected permissions do not exist.' using errcode = '22023';
  end if;

  return v_name;
end;
$$;

create or replace function public.create_custom_role(
  p_name text,
  p_description text,
  p_permission_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_role public.roles;
begin
  v_name := public.validate_custom_role_input(null, p_name, p_permission_ids);

  insert into public.roles (name, description, is_system, base_role)
  values (v_name, p_description, false, 'receptionist')
  returning * into v_role;

  insert into public.role_permissions (role_id, permission_id)
  select v_role.id, x from unnest(p_permission_ids) x;

  return jsonb_build_object(
    'role_id', v_role.id,
    'role_name', v_role.name,
    'base_role', v_role.base_role,
    'permission_count', cardinality(p_permission_ids)
  );
end;
$$;

create or replace function public.update_custom_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permission_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_previous public.roles;
begin
  -- Permission is checked before the lock, so a caller without roles.manage
  -- cannot hold a lock on the row.
  if not public.user_has_permission(auth.uid(), 'roles.manage') then
    raise exception 'FORBIDDEN: Missing permission ''roles.manage''' using errcode = '42501';
  end if;

  -- Serialises concurrent edits of this role until commit.
  select * into v_previous
  from public.roles r
  where r.id = p_role_id
  for update;

  if not found then
    raise exception 'Select a valid role.' using errcode = 'P0002';
  end if;

  if v_previous.is_system then
    raise exception 'System roles cannot be edited.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role_id = p_role_id
  ) then
    raise exception 'You cannot modify your own assigned role.' using errcode = '42501';
  end if;

  v_name := public.validate_custom_role_input(p_role_id, p_name, p_permission_ids);

  update public.roles r
     set name = v_name,
         description = p_description,
         updated_at = timezone('utc', now())
   where r.id = p_role_id;

  delete from public.role_permissions rp
  where rp.role_id = p_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, x from unnest(p_permission_ids) x;

  return jsonb_build_object(
    'role_id', p_role_id,
    'previous_role_name', v_previous.name,
    'role_name', v_name,
    'previous_base_role', v_previous.base_role,
    'base_role', v_previous.base_role,
    'permission_count', cardinality(p_permission_ids)
  );
end;
$$;

revoke all on function public.validate_custom_role_input(uuid, text, uuid[]) from public, anon, service_role;
revoke all on function public.create_custom_role(text, text, uuid[]) from public, anon, service_role;
revoke all on function public.update_custom_role(uuid, text, text, uuid[]) from public, anon, service_role;
grant execute on function public.validate_custom_role_input(uuid, text, uuid[]) to authenticated;
grant execute on function public.create_custom_role(text, text, uuid[]) to authenticated;
grant execute on function public.update_custom_role(uuid, text, text, uuid[]) to authenticated;

commit;
