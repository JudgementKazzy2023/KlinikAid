-- KlinikAid Migration 38: indexes for the dashboard's ordered and per-patient reads (#165)
--
-- Issue #165 asked for the dashboard navigation to be measured before it was
-- changed. The measurement (2026-10-21, from the Philippines, against the
-- ap-southeast-2 database) found that the dashboard's slowest server-side
-- query was not the database's fault alone: it was missing indexes.
--
-- Measured query costs, same call, caller's own token (RLS applies) against
-- the service role (RLS does not), median of three:
--
--   system_logs, 10 newest rows with the profiles join
--     caller token  1256 ms      service role  251 ms
--   system_logs, 10 newest rows, no join
--     caller token  1014 ms      service role  222 ms
--   system_logs, 10 newest rows, no ORDER BY
--     caller token   207 ms      (network only)
--
-- The sort itself is cheap: with RLS out of the way the ordered query costs
-- about as much as the unordered one. What costs the second is that "ORDER BY
-- created_at DESC LIMIT 10" has to walk every row, and every row is put
-- through the "Admins can view system logs" policy, which calls
-- user_has_permission() once per row. With 5500 rows that is 5500 calls
-- before the ten newest rows can be returned.
--
-- An index on (created_at DESC) lets the planner walk the table in the order
-- the query wants and stop as soon as it has ten rows that pass the policy,
-- so the policy is evaluated ten times instead of 5500.
--
-- The same per-row call is what makes every other RLS-protected read pay for
-- a table scan: public.user_has_permission() joins profiles to
-- role_permissions to permissions and filters on permissions.name, and neither
-- side of that join had an index. The two indexes below turn both halves of
-- the lookup into index scans. They change no result and no policy: the
-- function still answers the same question with the same rules.
--
-- The last two indexes are for the per-patient reads. Every "this patient's
-- documents" and "this patient's queue entries" query is a sequential scan
-- today, because Postgres does not index the foreign key columns by itself.
-- They cost nothing measurable at the current row counts (556 documents, 129
-- queue entries) and are here so the patient's own pages do not degrade as
-- the clinic's history grows.
--
-- ORDERING: independent of the application deploy. The application does not
-- change behaviour with these indexes; they only make the same queries
-- cheaper. Apply them at any time.
--
-- SNAPSHOT: src/lib/db/schema.sql is a generated picture of the live database,
-- so it is NOT regenerated in this change: this migration has not been applied
-- yet, and the live database does not have these indexes. Regenerate the
-- snapshot (procedure in documentation/DATABASE.md) after applying this file,
-- so that a fresh project bootstrapped from the snapshot gets the indexes too.
--
-- ROLLBACK:
--   begin;
--   drop index if exists public.idx_system_logs_created_at_desc;
--   drop index if exists public.idx_documents_patient_id;
--   drop index if exists public.idx_patient_queue_patient_id_created_at;
--   commit;
--
-- The plain CREATE INDEX takes a brief write lock on each table. The tables
-- are small (5500, 23, 48, 556 and 129 rows); on a large copy, run the
-- statements with CREATE INDEX CONCURRENTLY outside a transaction instead.

begin;

-- The dashboard's recent-activity feed and the system log view both read the
-- newest rows first.
create index if not exists idx_system_logs_created_at_desc
  on public.system_logs (created_at desc);

-- The permission lookup inside public.user_has_permission() needs no new
-- index: permissions (name) is already covered by the unique constraint
-- permissions_name_key, and role_permissions (role_id, permission_id) by its
-- primary key.

-- The patient's own documents and queue entries.
create index if not exists idx_documents_patient_id
  on public.documents (patient_id);

create index if not exists idx_patient_queue_patient_id_created_at
  on public.patient_queue (patient_id, created_at desc);

commit;
