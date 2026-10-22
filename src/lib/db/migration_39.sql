-- KlinikAid Migration 39: one patient row per profile (unique patients.profile_id)
-- (JudgementKazzy2023/Klinikaid-Mobile-App#41)
--
-- Why: the mobile app can end up with two patient rows for one account, and
-- the second one breaks the patient's dashboard.
--
-- The mobile app creates a patient's clinical record through the
-- create-patient-record Edge function. That function is now idempotent, but
-- idempotency is a property of the code, not of the database: two calls that
-- overlap, or a call that races a direct insert, both read "no patient row
-- for this profile yet" and both insert one. Nothing in the schema stopped
-- the second row.
--
-- Two rows for one profile then break the mobile app. Its
-- getPatientByProfileId() reads the patient's own record with
-- .eq('profile_id', profileId).maybeSingle(); PostgREST answers a multi-row
-- match with more than one row, so maybeSingle() throws instead of returning
-- the record, and the dashboard fails to load.
--
-- What this adds:
--
--   patients_profile_id_key
--     A UNIQUE index on public.patients (profile_id). A second insert for a
--     profile that already has a row now fails with a unique violation
--     (SQLSTATE 23505) instead of creating a duplicate, so the Edge function
--     cannot be raced into one. It is a plain unique index, so an upsert can
--     name the column (on conflict (profile_id)) rather than the constraint.
--
-- NULLs are not affected. Postgres treats NULLs as distinct in a unique
-- index, so the rows whose profile_id is NULL may stay as they are, and
-- ON DELETE SET NULL on patients_profile_id_fkey keeps working: deleting a
-- profile leaves its patient's row with a NULL profile_id instead of failing.
--
-- Precondition evidence (read-only count, 2026-10-22, against the live
-- database): 510 rows in public.patients, 0 profile_id values shared by more
-- than one row, and 32 rows with profile_id NULL. The index therefore applies
-- to this data without a rewrite.
--
-- PRE-FLIGHT: run this query first. It must return zero rows:
--
--   select profile_id, count(*)
--     from public.patients
--    where profile_id is not null
--    group by 1
--   having count(*) > 1;
--
-- If it returns rows, stop: do not apply this file and do not delete data.
-- Duplicated profiles are a data question for someone to decide on, not
-- something this migration may resolve by removing rows. The check inside the
-- transaction raises the offending profile_ids and aborts, so a file applied
-- without the pre-flight stops there too instead of half-applying.
--
-- ORDERING: apply before deploying the updated create-patient-record Edge
-- function. Independent of the web app deploy: the web app's own insert
-- paths already create at most one row per profile, so no web application
-- code has to change with this index.
--
-- The web app's only insert into public.patients is
-- src/lib/patient/createPatient.ts, reached from
-- src/app/(auth)/register/actions.ts (self-registration) and
-- src/app/(dashboard)/reception/dashboard/actions.ts (receptionist-created).
-- In every one of those paths profile_id is the id of an Auth user created
-- immediately before the insert, and an address that already has an account
-- returns before the insert happens, so the web app cannot itself create two
-- rows for one profile. The web app never writes patients.profile_id: its
-- only update on patients sets contact_number and address
-- (src/app/(dashboard)/profile/actions.ts) and filters on profile_id; every
-- other patients reference in src/ is a read. What the web app cannot rule
-- out is the race the mobile path has: the insert policy "Patients can
-- insert own patient record" (WITH CHECK (profile_id = auth.uid())) lets a
-- patient's own session insert a row, and a per-statement check is not a
-- uniqueness guarantee, so two concurrent inserts both pass it. That is what
-- this index closes.
--
-- SNAPSHOT: src/lib/db/schema.sql is a generated picture of the live
-- database, so it is NOT regenerated in this change: this migration has not
-- been applied yet, and the live database does not have this index.
-- Regenerate the snapshot (procedure in documentation/DATABASE.md) after
-- applying this file, so that a fresh project bootstrapped from the
-- snapshot gets the index too.
--
-- ROLLBACK:
--   begin;
--   drop index if exists public.patients_profile_id_key;
--   commit;
--
-- The plain CREATE UNIQUE INDEX takes a brief lock that blocks writes to the
-- table. On a large table, run the statement with CREATE UNIQUE INDEX
-- CONCURRENTLY outside a transaction instead; public.patients has about 510
-- rows, so the plain form is fine here.

begin;

-- Preflight: report every profile that already has more than one patient row
-- in one message instead of failing halfway through, and never mutate data
-- to make the index fit.
do $$
declare
  v_duplicates text;
begin
  select string_agg(format('%s (%s rows)', d.profile_id, d.row_count), ', ' order by d.profile_id)
    into v_duplicates
    from (
      select p.profile_id, count(*) as row_count
        from public.patients p
       where p.profile_id is not null
       group by p.profile_id
      having count(*) > 1
    ) d;

  if v_duplicates is not null then
    raise exception 'migration_39: these profile_ids already have more than one patient row; resolve them by hand before applying: %',
      v_duplicates
      using errcode = '23505';
  end if;
end;
$$;

-- One patient row per profile. NULL profile_ids stay distinct, so the rows
-- that have no profile, and the rows left behind by ON DELETE SET NULL, are
-- not affected.
create unique index if not exists patients_profile_id_key
  on public.patients (profile_id);

commit;
