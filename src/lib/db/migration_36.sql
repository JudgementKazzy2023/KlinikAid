-- KlinikAid Migration 36: patients write and delete only their pending uploads
--
-- migration_09 let a patient insert and delete ANY object under their own
-- folder of the patient-documents bucket. The policy was named "delete own
-- pending files", but nothing limited it to pending files, so a patient could
-- also remove or pre-place the files behind documents already submitted to the
-- clinic.
--
-- Since #45/#106 the application writes the final file of a submission with the
-- service role (<user>/<assessment>.<ext>), and the only object a patient's own
-- session writes is the pending upload:
--     <user>/pending-submissions/<assessment>/source.<ext>
-- The two places that delete a final file (withdrawing a pending document, and
-- discarding an unused final file) use the service role after their own
-- ownership and status checks.
--
-- What this changes (storage.objects, bucket patient-documents only):
--   INSERT "Allow patient upload own files"          -> own folder AND pending-submissions/
--   DELETE "Allow patient delete own pending files"  -> own folder AND pending-submissions/
-- Read policies are unchanged.
--
-- ORDERING: CONTRACT. Apply only after the application change that moves the
-- final-file deletes to the service role is deployed. Applied earlier, a patient
-- withdrawing a pending document would delete the row but leave its file behind
-- (logged, not user-visible).
--
-- ROLLBACK (restores the migration_09 policies exactly):
--   begin;
--   drop policy "Allow patient upload own files" on storage.objects;
--   drop policy "Allow patient delete own pending files" on storage.objects;
--   create policy "Allow patient upload own files" on storage.objects for insert
--     with check (bucket_id = 'patient-documents' and (storage.foldername(name))[1] = auth.uid()::text);
--   create policy "Allow patient delete own pending files" on storage.objects for delete
--     using (bucket_id = 'patient-documents' and (storage.foldername(name))[1] = auth.uid()::text);
--   commit;

begin;

drop policy if exists "Allow patient upload own files" on storage.objects;
drop policy if exists "Allow patient delete own pending files" on storage.objects;

create policy "Allow patient upload own files"
  on storage.objects for insert
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'pending-submissions'
  );

create policy "Allow patient delete own pending files"
  on storage.objects for delete
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'pending-submissions'
  );

commit;
