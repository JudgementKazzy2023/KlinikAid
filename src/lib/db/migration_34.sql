-- KlinikAid Migration 34: a document assessment is consumed exactly once (#45)
--
-- confirmSubmitDocumentAction read the pending assessment, uploaded a fresh
-- final file, inserted a new documents row, and only then deleted the pending
-- row (a failed delete was logged and success returned anyway). Concurrent
-- confirmations of one assessment, or a retry after a lost response, each
-- passed the read and each created a document and a file, so one upload
-- showed up as several submissions to the patient and to reception.
--
-- What this adds:
--
--   documents.source_assessment_id
--     The pending_document_ocr id a document was created from. Nullable: every
--     existing row, and every row the previous code inserts, keeps null. The
--     partial unique index makes "one document per assessment" a database rule
--     rather than something each request has to check.
--
--   submit_assessed_document(assessment, user, patient, file_path, metadata)
--     Deletes the pending row with DELETE ... RETURNING and inserts the
--     document in the same transaction, so the assessment is either consumed
--     and turned into exactly one document, or left untouched. A concurrent
--     second call blocks on the pending row's lock, finds it gone once the
--     first commits, and returns the document the first one created with
--     created = false. A later retry gets the same answer. If there is neither
--     a pending row nor a document it raises P0002.
--
--     The file path must be <user>/<assessment>.<ext>: one deterministic final
--     path per assessment, so concurrent requests cannot leave several final
--     files behind, and the caller cannot point a document at a file outside
--     the patient's own folder.
--
--     SECURITY INVOKER and executable by service_role only. Patients have no
--     INSERT policy on documents (migration_23), and the action already inserts
--     with the service role using values it derived from the authenticated
--     session; this keeps exactly that trust boundary and does not open a new
--     patient-callable write path over PostgREST. Ownership is checked
--     explicitly: the pending row must belong to p_user_id and p_patient_id,
--     and p_patient_id must be p_user_id's patient record.
--
-- EXPAND: the previous application code keeps working once this is applied. It
-- never sets source_assessment_id, so the unique index ignores its rows, and it
-- does not call the function.
--
-- ORDERING: apply before deploying the action that calls
-- submit_assessed_document(). The new action fails every confirmation until
-- this exists.
--
-- ROLLBACK (after reverting the action to its previous code)
--   drop function if exists public.submit_assessed_document(uuid, uuid, uuid, text, jsonb);
--   drop index if exists public.documents_source_assessment_id_key;
--   alter table public.documents drop column if exists source_assessment_id;
--   Dropping the column only loses the link from a document to its assessment.

begin;

alter table public.documents
  add column if not exists source_assessment_id uuid;

create unique index if not exists documents_source_assessment_id_key
  on public.documents (source_assessment_id)
  where source_assessment_id is not null;

create or replace function public.submit_assessed_document(
  p_assessment_id uuid,
  p_user_id uuid,
  p_patient_id uuid,
  p_file_path text,
  p_extracted_metadata jsonb,
  out document_id uuid,
  out created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pending public.pending_document_ocr;
  v_path_prefix text;
  v_extension text;
begin
  if p_assessment_id is null or p_user_id is null or p_patient_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and p.profile_id = p_user_id
  ) then
    raise exception 'patient does not belong to user' using errcode = '42501';
  end if;

  v_path_prefix := p_user_id::text || '/' || p_assessment_id::text || '.';
  v_extension := substr(coalesce(p_file_path, ''), char_length(v_path_prefix) + 1);
  if left(coalesce(p_file_path, ''), char_length(v_path_prefix)) <> v_path_prefix
     or v_extension = ''
     or strpos(v_extension, '/') > 0 then
    raise exception 'invalid file path' using errcode = '22023';
  end if;

  delete from public.pending_document_ocr o
   where o.id = p_assessment_id
     and o.user_id = p_user_id
     and o.patient_id = p_patient_id
  returning * into v_pending;

  if not found then
    -- Already consumed: by a concurrent call that committed while this one
    -- waited on the row lock, or by an earlier call whose response was lost.
    select d.id into document_id
      from public.documents d
     where d.source_assessment_id = p_assessment_id
       and d.uploader_id = p_user_id;

    if found then
      created := false;
      return;
    end if;

    raise exception 'document assessment not found' using errcode = 'P0002';
  end if;

  begin
    insert into public.documents
      (patient_id, uploader_id, file_name, file_path, file_type, status, ocr_text, extracted_metadata, source_assessment_id)
    values (
      v_pending.patient_id,
      p_user_id,
      v_pending.file_name,
      p_file_path,
      v_pending.file_type,
      'pending',
      case when v_pending.ocr_text ~ '\S' then v_pending.ocr_text end,
      p_extracted_metadata,
      p_assessment_id
    )
    returning id into document_id;
  exception when unique_violation then
    -- A pending row re-inserted under an id that was already consumed. The
    -- delete above stands; report the document that already exists.
    select d.id into document_id
      from public.documents d
     where d.source_assessment_id = p_assessment_id
       and d.uploader_id = p_user_id;

    if not found then
      raise;
    end if;

    created := false;
    return;
  end;

  created := true;
end;
$$;

revoke all on function public.submit_assessed_document(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_assessed_document(uuid, uuid, uuid, text, jsonb) to service_role;

commit;
