-- KlinikAid Migration 37: role names are trimmed, bounded and case-insensitively unique (#127)
--
-- Issue #72 reported a 200-character custom role name and an 'ADMIN' role that
-- could be created beside the system role 'admin'. Migration 32 gave the
-- write path a 3-character minimum and a uniqueness check, but the check
-- compared names case-sensitively against the plain UNIQUE(name) constraint,
-- and nothing anywhere capped the length.
--
-- What this changes:
--
--   public.trim_role_name()
--     Trims with the whitespace set JavaScript String.trim() removes, so the
--     database normalises exactly what the app sends. IMMUTABLE and not
--     security definer; it keeps the default PUBLIC EXECUTE because the
--     SECURITY INVOKER write functions and CHECK constraints execute it for
--     every writer.
--
--   public.roles
--     roles_name_length_check: the stored name must already be trimmed and
--       3-50 characters. ADD CONSTRAINT scans and validates every existing
--       row; a violating row fails the migration. Nothing is rewritten.
--     roles_name_folded_idx: UNIQUE INDEX on (lower(trim_role_name(name))).
--       Two writes that differ only by case or surrounding whitespace collide
--       here even when they race past the validator's read, so the invariant
--       holds under concurrent writes. A role renamed to its own name —
--       including a case-only change — keeps the same index key and is
--       unaffected.
--
--   validate_custom_role_input(): the same 3-50 bound applies to the trimmed
--   name, and the duplicate check compares the trimmed, lower-cased name
--   against every other role, system roles included. Renaming a role to
--   itself (or only its casing) stays allowed because the comparison excludes
--   the role's own id.
--
-- The shared limit lives in src/lib/auth/custom-role-input.ts (ROLE_NAME_MAX)
-- and is shown in the roles UI; this file repeats the same literal 50, and
-- the database CHECK is the authoritative backstop for every writer.
--
-- Existing data was inspected with the service role before writing this file
-- (2026-10-20): 10 roles, no case-folded collisions, no untrimmed names, no
-- name over 50 characters (longest 23). If a deployment's data has drifted
-- into a violation, the preflight below raises the offending names and stops;
-- the data is reported for a decision, never deleted or renamed automatically.
--
-- ORDERING: apply before or together with the app change. The new app code
-- also runs against the old schema (its checks are a subset of the
-- database's), but until this migration is applied the database still
-- accepts case-variant duplicates and unbounded names from any writer.
--
-- ROLLBACK
--   drop index if exists public.roles_name_folded_idx;
--   alter table public.roles drop constraint if exists roles_name_length_check;
--   drop function if exists public.trim_role_name(text);
--   and restore validate_custom_role_input() from migration_32.

begin;

-- The whitespace set ECMAScript String.trim() removes: WhiteSpace and
-- LineTerminator (U+0009-U+000D, U+0020, U+00A0, U+1680, U+2000-U+200A,
-- U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF).
create or replace function public.trim_role_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    coalesce(p_name, ''),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$$;

-- Preflight: report every violating name in one message instead of failing
-- halfway through, and never mutate data to make the constraints fit.
do $$
declare
  v_collisions text;
  v_untrimmed text;
  v_out_of_bounds text;
begin
  select string_agg(format('''%s''', r.name), ', ' order by r.name)
  into v_collisions
  from public.roles r
  where exists (
    select 1 from public.roles r2
    where lower(public.trim_role_name(r2.name)) = lower(public.trim_role_name(r.name))
      and r2.id < r.id
  );

  if v_collisions is not null then
    raise exception 'migration_37: role names collide case-insensitively; resolve them by hand before applying: %',
      v_collisions
      using errcode = '23505';
  end if;

  select string_agg(format('''%s''', r.name), ', ' order by r.name)
  into v_untrimmed
  from public.roles r
  where r.name <> public.trim_role_name(r.name);

  if v_untrimmed is not null then
    raise exception 'migration_37: role names have surrounding whitespace; resolve them by hand before applying: %',
      v_untrimmed
      using errcode = '22023';
  end if;

  select string_agg(format('''%s'' (%s characters)', r.name, char_length(r.name)), ', ' order by r.name)
  into v_out_of_bounds
  from public.roles r
  where char_length(r.name) < 3 or char_length(r.name) > 50;

  if v_out_of_bounds is not null then
    raise exception 'migration_37: role names violate the 3-50 character limit; resolve them by hand before applying: %',
      v_out_of_bounds
      using errcode = '22023';
  end if;
end;
$$;

alter table public.roles
  add constraint roles_name_length_check check (
    name = public.trim_role_name(name)
    and char_length(name) between 3 and 50
  );

create unique index roles_name_folded_idx on public.roles (lower(public.trim_role_name(name)));

-- The same bound and comparison as the index, raised with the messages the
-- app shows. The permission checks are unchanged from migration 32.
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
  v_name text := public.trim_role_name(p_name);
  v_known integer;
begin
  if not public.user_has_permission(auth.uid(), 'roles.manage') then
    raise exception 'FORBIDDEN: Missing permission ''roles.manage''' using errcode = '42501';
  end if;

  if char_length(v_name) < 3 then
    raise exception 'Role name must be at least 3 characters.' using errcode = '22023';
  end if;

  if char_length(v_name) > 50 then
    raise exception 'Role name must be 50 characters or fewer.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.roles r
    where lower(public.trim_role_name(r.name)) = lower(v_name)
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

commit;
