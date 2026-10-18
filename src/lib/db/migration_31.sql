-- KlinikAid Migration 31: publish documents and patient_queue to Realtime (#86)
--
-- The reception board (ReceptionKanban) and the patient submissions page
-- subscribe to postgres_changes on public.documents and public.patient_queue,
-- but the supabase_realtime publication had no tables, so no change was ever
-- delivered and both pages only updated on reload.
--
-- Only the two subscribed tables are added. Realtime checks each INSERT and
-- UPDATE payload against the subscriber's SELECT policies, so a patient
-- receives only their own rows and staff only what their permissions already
-- let them read.
--
-- Replica identity is deliberately left at DEFAULT. Realtime cannot apply RLS
-- to DELETE events, and with DEFAULT the old record carries only the primary
-- key. REPLICA IDENTITY FULL would broadcast whole deleted rows to every
-- subscriber of the table.
--
-- ORDERING: independent. The subscribing code is already deployed.
--
-- ROLLBACK
--   alter publication supabase_realtime drop table public.documents, public.patient_queue;

begin;

alter publication supabase_realtime add table public.documents, public.patient_queue;

commit;
