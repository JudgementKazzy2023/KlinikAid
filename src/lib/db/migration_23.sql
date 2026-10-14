-- KlinikAid Migration 23: close patient writes on documents; stop exposing RAG embeddings
--
-- ===========================================================================
-- PART 1 -- documents (issue #57)
-- ===========================================================================
--
-- CONTEXT
-- The patient-facing documents policies checked only uploader_id = auth.uid():
--
--   "Patients can insert own documents"        FOR INSERT WITH CHECK (uploader_id = auth.uid())
--   "Patients can update own pending documents" FOR UPDATE USING/WITH CHECK
--                                               (uploader_id = auth.uid() AND status = 'pending')
--
-- With their own session and the public anon key, a patient could therefore
--   1. insert a document whose patient_id is ANOTHER patient, which then shows
--      up under that patient and in the reception queue;
--   2. insert their own document already status = 'approved', skipping triage;
--   3. re-point one of their pending documents at another patient and rewrite
--      extracted_metadata, defeating the identity injection that
--      patient/templates/actions.ts performs on submit.
-- All three were reproduced against the live project on 6e9a61d.
--
-- FIX
-- Patients get no direct INSERT or UPDATE on documents at all. Every legitimate
-- patient write already goes through a server action that authenticates the
-- user and derives patient_id / uploader_id / status itself:
--   patient/submit/actions.ts     confirmSubmitDocumentAction
--   patient/templates/actions.ts  submitTemplateAction
-- Those two inserts now use the service-role client (same commit), so they no
-- longer depend on a patient INSERT policy. Nothing in the app UPDATEs a
-- document as a patient.
--
-- A tightened INSERT policy (patient_id = own, status = 'pending') was the
-- alternative. It was rejected because it still lets a patient insert directly
-- with arbitrary extracted_metadata / ocr_text, which is the same defect as #3
-- arriving through INSERT instead of UPDATE. RLS cannot tell a server-built row
-- from a hand-built one when both use the patient's JWT.
--
-- Kept unchanged:
--   "Patients can view own documents"          SELECT
--   "Patients can delete own pending documents" DELETE (patient/submissions/actions.ts
--                                                uses the patient's own session)
--   the documents.manage policies               reception approve/reject
--
-- DEPLOY ORDER: ship the application change first. The service-role inserts
-- work under both the old and new policies; applying this migration before the
-- code deploys would break patient uploads and template submissions.

DROP POLICY IF EXISTS "Patients can insert own documents" ON public.documents;
DROP POLICY IF EXISTS "Patients can update own pending documents" ON public.documents;

-- The live database has no recorded migration history, so the policy names
-- above come from schema.sql and are not guaranteed to match. After applying,
-- confirm that no INSERT, UPDATE or ALL policy remains that a patient satisfies:
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'documents'
--   ORDER BY cmd, policyname;
--
-- Expected: the two documents.manage FOR ALL policies, one SELECT, one DELETE.

-- ===========================================================================
-- PART 2 -- rag_documents (issue #39)
-- ===========================================================================
--
-- CONTEXT
-- "Anyone can read RAG documents" (USING (true)) is DELIBERATE. The corpus is
-- clinic information -- hours, services, preparation, prices, FAQ, the privacy
-- notice -- and is meant to be public. It is the one table the anon key can read
-- without a session, and that is intended.
--
-- What is not intended is that USING (true) grants the whole row, including
-- embedding: a vector(768) per chunk that is retrieval machinery, useless to a
-- client, and the bulk of every response.
--
-- FIX
-- Column-level privileges. SELECT on rag_documents is revoked from anon and
-- authenticated and re-granted on every column except embedding. RLS policies
-- are unchanged: rows stay public, the vector does not.
--
-- A table-level GRANT SELECT overrides column-level ones, so the table grant has
-- to be revoked first for this to mean anything.
--
-- Unaffected:
--   match_documents() is SECURITY DEFINER and reads embedding as its owner, so
--     the chatbot's similarity search keeps working.
--   admin/rag/page.tsx selects id, title, content, metadata, created_at only.
--   admin/rag/actions.ts uses the service-role client.
--
-- Consequence: select=* from anon/authenticated is now a 42501 permission error
-- rather than a row set, because * includes embedding. Name the columns.
-- A column added to rag_documents later is NOT readable by anon/authenticated
-- until it is added to the GRANT below -- deliberately fail-closed.

REVOKE SELECT ON public.rag_documents FROM anon, authenticated;
GRANT SELECT (id, title, content, metadata, created_at)
  ON public.rag_documents TO anon, authenticated;

COMMENT ON POLICY "Anyone can read RAG documents" ON public.rag_documents IS
  'Deliberately public: the clinic-information corpus behind the patient chatbot. '
  'embedding is withheld by column privileges (migration_23), not by this policy.';

-- VERIFY (anon key, no session):
--   GET /rest/v1/rag_documents?select=id,title   -> 200, rows
--   GET /rest/v1/rag_documents?select=embedding  -> 401/403, code 42501
-- `npm run test:rls` asserts exactly this, plus anon seeing 0 rows everywhere else.
