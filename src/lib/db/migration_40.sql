-- KlinikAid Migration 40: one transaction for a patient's template submission
-- (JudgementKazzy2023/Klinikaid-Mobile-App#36, #16; contract in mobile PR #3)
--
-- Why: patients lost their INSERT policy on documents (migration_23), so the
-- mobile app has no way to submit a form template. The web action inserts
-- with the service role, then writes the audit event separately, and checks
-- nothing for duplicates. Mobile needs a server operation that is safe to
-- retry over a bad connection, and both clients need the same duplicate rule.
--
-- What this adds:
--
--   public.submission_receipts
--     One row per accepted request, keyed (user_id, operation, request_id).
--     A retry with the same request_id returns the original document instead
--     of inserting a second one. Receipts are kept 30 days (accepted in #36:
--     the 7-day client retry horizon plus a reconciliation margin). Rows are
--     never deleted here; an expired receipt is reported, never reused. A
--     patient cancelling the pending document (web patient/submissions)
--     clears document_id, so a late retry cannot resubmit what they withdrew.
--     RLS on, no policies: only the service role reads or writes it.
--
--   public.submit_patient_template(...)
--     In one transaction: replay/conflict/expiry check on the receipt, the
--     duplicate rule, the document row, the attributed DOCUMENT_SUBMITTED
--     event in system_logs and the receipt. Any failure rolls back all of it,
--     so there is never a document without its audit event or receipt.
--     Callers: supabase/functions/patient-document-submission (mobile) and
--     src/app/(dashboard)/patient/templates/actions.ts (web).
--
-- Duplicate rule (accepted in #36): a patient may have one pending document
-- per category. The category of a template is its template_id; of an upload,
-- extracted_metadata.document_type (mobile writes it, web uploads do not, so
-- they are 'other'). 'other' is exempt. Existing rows are never changed: a
-- collision rejects the NEW submission and returns the existing document.
-- The check is atomic against other callers of this function through a
-- transaction advisory lock on (patient, category). submit_assessed_document
-- (web uploads, migration_34) does not take that lock yet; uploads are
-- Stage 2 and stay contained on mobile.
--
-- Outcomes (returned as jsonb, never raised, so the caller can tell them apart):
--   {"outcome":"created","document_id":...}
--   {"outcome":"replayed","document_id":...}  same request_id, same content
--   {"outcome":"conflict"}                    same request_id, other content
--   {"outcome":"expired"}                     receipt older than 30 days
--   {"outcome":"withdrawn"}                   the patient cancelled that document
--   {"outcome":"duplicate","document_id":...,"status":"pending"}
--
-- ORDERING: apply before deploying patient-document-submission and before
-- the web deploy that calls this function. Nothing existing calls it, so
-- applying it alone changes no behaviour.
--
-- SNAPSHOT: not applied yet, so src/lib/db/schema.sql is not regenerated.
-- Regenerate it (documentation/DATABASE.md) after applying this file.
--
-- ROLLBACK (only before any client calls it; receipts are audit evidence):
--   begin;
--   drop function if exists public.submit_patient_template(uuid, uuid, text, uuid, text, text, jsonb, text);
--   drop table if exists public.submission_receipts;
--   commit;

begin;

create table if not exists public.submission_receipts (
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null check (operation in ('submit_template')),
  request_id uuid not null,
  fingerprint text not null,
  -- Null once the patient cancels the pending document (patient/submissions).
  document_id uuid references public.documents (id) on delete set null,
  first_accepted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (user_id, operation, request_id)
);

alter table public.submission_receipts enable row level security;
revoke all on table public.submission_receipts from public, anon, authenticated;
grant select, insert on table public.submission_receipts to service_role;

create or replace function public.submit_patient_template(
  p_user_id uuid,
  p_request_id uuid,
  p_fingerprint text,
  p_patient_id uuid,
  p_file_name text,
  p_file_path text,
  p_metadata jsonb,
  p_description text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt public.submission_receipts;
  v_category text;
  v_existing uuid;
  v_document_id uuid;
begin
  if p_user_id is null or p_request_id is null or p_patient_id is null
     or coalesce(p_fingerprint, '') = '' or jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and p.profile_id = p_user_id
  ) then
    raise exception 'patient does not belong to user' using errcode = '42501';
  end if;

  v_category := coalesce(nullif(p_metadata ->> 'template_id', ''), 'other');

  -- Same request_id: a concurrent retry waits here, then sees the receipt.
  perform pg_advisory_xact_lock(
    hashtextextended('submit_template:' || p_user_id::text || ':' || p_request_id::text, 0));

  select * into v_receipt
    from public.submission_receipts r
   where r.user_id = p_user_id
     and r.operation = 'submit_template'
     and r.request_id = p_request_id;

  if found then
    if now() >= v_receipt.expires_at then
      return jsonb_build_object('outcome', 'expired');
    end if;
    if v_receipt.document_id is null then
      return jsonb_build_object('outcome', 'withdrawn');
    end if;
    if v_receipt.fingerprint <> p_fingerprint then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    return jsonb_build_object('outcome', 'replayed', 'document_id', v_receipt.document_id);
  end if;

  if v_category <> 'other' then
    perform pg_advisory_xact_lock(
      hashtextextended('pending_document:' || p_patient_id::text || ':' || v_category, 0));

    select d.id into v_existing
      from public.documents d
     where d.patient_id = p_patient_id
       and d.status = 'pending'
       and coalesce(nullif(
             case when d.file_type = 'template'
                  then d.extracted_metadata ->> 'template_id'
                  else d.extracted_metadata ->> 'document_type' end, ''), 'other') = v_category
     order by d.created_at
     limit 1;

    if found then
      return jsonb_build_object('outcome', 'duplicate', 'document_id', v_existing, 'status', 'pending');
    end if;
  end if;

  insert into public.documents
    (patient_id, uploader_id, file_name, file_path, file_type, status, extracted_metadata)
  values
    (p_patient_id, p_user_id, p_file_name, p_file_path, 'template', 'pending', p_metadata)
  returning id into v_document_id;

  insert into public.system_logs (user_id, event_type, description, metadata)
  values (p_user_id, 'DOCUMENT_SUBMITTED', p_description, jsonb_build_object('document_id', v_document_id));

  insert into public.submission_receipts (user_id, operation, request_id, fingerprint, document_id)
  values (p_user_id, 'submit_template', p_request_id, p_fingerprint, v_document_id);

  return jsonb_build_object('outcome', 'created', 'document_id', v_document_id);
end;
$$;

revoke all on function public.submit_patient_template(uuid, uuid, text, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_patient_template(uuid, uuid, text, uuid, text, text, jsonb, text) to service_role;

commit;
