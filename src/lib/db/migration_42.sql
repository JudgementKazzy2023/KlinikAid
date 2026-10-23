-- KlinikAid Migration 42: atomic assessed uploads, shared with web and mobile
-- Why: uploads need receipts, a shared category lock, and safe file ownership.
-- Adds submit_patient_upload and its owner-scoped outcome lookup; widens the
-- receipt operation constraint. Consumes an assessment exactly once, writes the
-- document, DOCUMENT_SUBMITTED event and receipt in one transaction.
-- Outcomes: created/replayed/conflict/expired/withdrawn/duplicate,
-- assessment_not_found (missing, wrong owner, or already consumed), file_invalid.
-- Storage decision: promote the existing pending object IN PLACE, without a
-- second physical object/copy. A row lock plus transactional metadata seal and
-- an immutable-object trigger prevent a submitted file being removed/replaced
-- while a document references it. Once the patient cancels the document (its
-- row is deleted), the file can be removed again, exactly as today.
-- VERIFY in an isolated Supabase project before applying: this adds a trigger
-- on storage.objects and writes its metadata, both owned by Supabase Storage.
-- Failed transactions leave only the original pending draft, never a final copy.
-- ORDERING: apply after 34/36/41 and before deploying the upload routes/web action.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: revert upload callers first; preserve all receipts and object seals.
-- Drop the two upload RPCs if required, but retain the trigger while documents
-- reference promoted objects (drop trigger protect_submitted_upload_object on
-- storage.objects only after none do). Do not narrow the operation constraint or delete
-- upload receipts after any accepted submission: these are reconciliation evidence.

begin;
alter table public.submission_receipts
  drop constraint submission_receipts_operation_check;
alter table public.submission_receipts
  add constraint submission_receipts_operation_check
  check (operation in ('submit_template', 'submit_upload'));

create or replace function public.protect_submitted_upload_object()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Protected only while a document references the file. A patient cancelling
  -- a pending document deletes the row first (web patient/submissions), and the
  -- file must then be removable as before; the seal alone does not keep it.
  if old.bucket_id = 'patient-documents' and exists (
       select 1 from public.documents d where d.file_path = old.name
     ) then
    -- Storage may update access timestamps during reads. Those bookkeeping
    -- fields cannot change the object identity, metadata or physical version.
    if tg_op = 'UPDATE' and
       (to_jsonb(new) - 'last_accessed_at' - 'updated_at') =
       (to_jsonb(old) - 'last_accessed_at' - 'updated_at') then return new; end if;
    raise exception 'submitted document file is immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger protect_submitted_upload_object
before delete or update on storage.objects
for each row execute function public.protect_submitted_upload_object();

create or replace function public.submit_patient_upload(
  p_user_id uuid, p_request_id uuid, p_fingerprint text, p_patient_id uuid,
  p_assessment_id uuid, p_metadata jsonb, p_pending jsonb, p_object_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.submission_receipts;
  v_pending public.pending_document_ocr;
  v_category text := coalesce(nullif(p_metadata ->> 'document_type', ''), 'other');
  v_existing uuid;
  v_document uuid;
  v_object uuid;
  v_metadata jsonb;
begin
  if p_user_id is null or p_request_id is null or p_assessment_id is null
     or coalesce(p_fingerprint, '') = '' or jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception 'missing argument' using errcode = '22023';
  end if;
  if not exists (select 1 from public.patients p where p.id = p_patient_id and p.profile_id = p_user_id) then
    raise exception 'patient does not belong to user' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('submit_upload:' || p_user_id::text || ':' || p_request_id::text, 0));
  select * into v_receipt from public.submission_receipts r
    where r.user_id = p_user_id and r.operation = 'submit_upload' and r.request_id = p_request_id;
  if found then
    if now() >= v_receipt.expires_at then return jsonb_build_object('outcome', 'expired'); end if;
    if v_receipt.document_id is null then return jsonb_build_object('outcome', 'withdrawn'); end if;
    if v_receipt.fingerprint <> p_fingerprint then return jsonb_build_object('outcome', 'conflict'); end if;
    return jsonb_build_object('outcome', 'replayed', 'document_id', v_receipt.document_id);
  end if;

  -- Lock without consuming first: rejected duplicates must retain the assessment.
  select * into v_pending from public.pending_document_ocr o
    where o.id = p_assessment_id and o.user_id = p_user_id and o.patient_id = p_patient_id for update;
  if not found or exists (select 1 from public.documents where source_assessment_id = p_assessment_id) then
    return jsonb_build_object('outcome', 'assessment_not_found');
  end if;
  if p_pending is null or not (to_jsonb(v_pending) @> p_pending) then
    return jsonb_build_object('outcome', 'assessment_not_found');
  end if;
  if v_pending.file_type not in ('application/pdf', 'image/jpeg', 'image/png') or
    v_pending.file_path !~ ('^' || p_user_id::text || '/pending-submissions/' || p_assessment_id::text || '/source\.' ||
      case v_pending.file_type when 'application/pdf' then 'pdf' when 'image/png' then 'png' else 'jpe?g' end || '$') then
    return jsonb_build_object('outcome', 'file_invalid');
  end if;
  -- The Storage row is locked through commit. Sealing updates its row version,
  -- so racing deletes/updates either see the seal or fail serialization.
  select id, metadata into v_object, v_metadata from storage.objects as object_row
    where bucket_id = 'patient-documents' and name = v_pending.file_path
      and to_jsonb(object_row) @> p_object_snapshot for update;
  if not found or coalesce(v_metadata ->> 'mimetype', '') <> v_pending.file_type or
     coalesce(v_metadata ->> 'size', '') !~ '^[0-9]+$' then
    return jsonb_build_object('outcome', 'file_invalid');
  end if;
  if (v_metadata ->> 'size')::numeric not between 1 and 5242880 then
    return jsonb_build_object('outcome', 'file_invalid');
  end if;

  if v_category <> 'other' then
    perform pg_advisory_xact_lock(hashtextextended('pending_document:' || p_patient_id::text || ':' || v_category, 0));
    select d.id into v_existing from public.documents d where d.patient_id = p_patient_id and d.status = 'pending'
      and coalesce(nullif(case when d.file_type = 'template' then d.extracted_metadata ->> 'template_id'
        else d.extracted_metadata ->> 'document_type' end, ''), 'other') = v_category order by d.created_at limit 1;
    if found then return jsonb_build_object('outcome', 'duplicate', 'document_id', v_existing, 'status', 'pending'); end if;
  end if;

  v_document := gen_random_uuid();
  -- Seal before document insertion; the trigger permits the first seal only.
  update storage.objects set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('klinikaid_document_id', v_document)
    where id = v_object;
  delete from public.pending_document_ocr where id = v_pending.id;
  insert into public.documents(id, patient_id, uploader_id, file_name, file_path, file_type, status, ocr_text, extracted_metadata, source_assessment_id)
    values (v_document, p_patient_id, p_user_id, v_pending.file_name, v_pending.file_path, v_pending.file_type,
      'pending', nullif(btrim(v_pending.ocr_text), ''), p_metadata, p_assessment_id);
  insert into public.system_logs(user_id, event_type, description, metadata)
    values (p_user_id, 'DOCUMENT_SUBMITTED', 'Patient submitted an assessed document', jsonb_build_object('document_id', v_document));
  insert into public.submission_receipts(user_id, operation, request_id, fingerprint, document_id)
    values (p_user_id, 'submit_upload', p_request_id, p_fingerprint, v_document);
  return jsonb_build_object('outcome', 'created', 'document_id', v_document);
end;
$$;
revoke all on function public.submit_patient_upload(uuid, uuid, text, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_patient_upload(uuid, uuid, text, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

create or replace function public.submit_patient_upload_outcome(p_user_id uuid, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.submission_receipts; s text;
begin
  if p_user_id is null or p_request_id is null then raise exception 'missing argument' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('submit_upload:' || p_user_id::text || ':' || p_request_id::text, 0));
  select * into r from public.submission_receipts where user_id = p_user_id and operation = 'submit_upload' and request_id = p_request_id;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if r.document_id is null then return jsonb_build_object('state', 'withdrawn', 'first_accepted_at', r.first_accepted_at); end if;
  select status into s from public.documents where id = r.document_id;
  return jsonb_build_object('state', 'committed', 'document_id', r.document_id, 'status', s,
    'first_accepted_at', r.first_accepted_at, 'replayable', now() < r.expires_at);
end;
$$;
revoke all on function public.submit_patient_upload_outcome(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_patient_upload_outcome(uuid, uuid) to service_role;
revoke all on function public.protect_submitted_upload_object() from public, anon, authenticated;
grant execute on function public.protect_submitted_upload_object() to service_role;

-- Reject API deletions before Storage cleanup; the trigger covers racing writes.
drop policy if exists "Allow patient delete own pending files" on storage.objects;
create policy "Allow patient delete own pending files" on storage.objects for delete using (
  bucket_id = 'patient-documents' and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'pending-submissions'
  and metadata ->> 'klinikaid_document_id' is null
  and not exists (select 1 from public.documents d where d.file_path = name)
);
commit;
