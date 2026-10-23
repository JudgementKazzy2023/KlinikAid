-- KlinikAid report: pending documents against the migration_41 duplicate rule
-- (JudgementKazzy2023/Klinikaid-Mobile-App#36; read-only, changes nothing)
--
-- Why: migration_41 lets a patient have one pending document per category
-- for NEW submissions. Rows written before it may already break that rule,
-- and #36 requires this report before template submission is re-enabled on
-- mobile. Existing rows are never mutated or merged: the report is for a
-- person to decide on, not input to a cleanup.
--
-- Category, exactly as submit_patient_template computes it:
--   file_type = 'template'  -> extracted_metadata.template_id
--   any other file_type     -> extracted_metadata.document_type
--   missing or empty        -> 'other' ('other' is exempt from the rule)
-- Known categories are the six CLINIC_TEMPLATES ids (src/lib/documentTemplates.ts)
-- plus 'other', which is what the mobile upload picker offers.
--
-- Output is ids, categories and counts only: no names, answers or OCR text.
-- Part 1 is an aggregate summary. Parts 2 and 3 list document and patient ids;
-- keep their results private (the maintainer retains them, per #3).
--
-- Run each part on its own (the Supabase SQL editor shows only the last result
-- of a script). Every part runs inside a READ ONLY transaction, so an edit to
-- this file that tries to write fails instead of changing data.

-- Part 1 — summary: pending rows per category, and how many patients and rows
-- are in conflict (more than one pending in the same non-'other' category).
begin transaction read only;
with pending as (
  select d.id, d.patient_id, d.file_type, d.created_at,
         case when d.file_type = 'template' then 'template' else 'upload' end as kind,
         nullif(case when d.file_type = 'template'
                     then d.extracted_metadata ->> 'template_id'
                     else d.extracted_metadata ->> 'document_type' end, '') as raw_category
    from public.documents d
   where d.status = 'pending'
), classified as (
  select p.*, coalesce(p.raw_category, 'other') as category
    from pending p
), conflicts as (
  select patient_id, category, count(*) as n
    from classified
   where category <> 'other'
   group by patient_id, category
  having count(*) > 1
)
select c.category,
       count(*) filter (where c.kind = 'template') as pending_templates,
       count(*) filter (where c.kind = 'upload') as pending_uploads,
       c.category in ('referral-form', 'lab-request', 'med-cert', 'procedure-consent',
                      'patient-intake', 'results-release', 'other') as known_category,
       coalesce((select count(*) from conflicts x where x.category = c.category), 0) as patients_in_conflict,
       coalesce((select sum(x.n) from conflicts x where x.category = c.category), 0) as rows_in_conflict
  from classified c
 group by c.category
 order by c.category;
rollback;

-- Part 2 — conflicts: each patient/category with more than one pending row.
-- oldest_document_id is the row a new submission's DUPLICATE_PENDING would
-- report; nothing here picks a winner or marks the others for removal.
begin transaction read only;
with classified as (
  select d.id, d.patient_id, d.created_at,
         coalesce(nullif(case when d.file_type = 'template'
                              then d.extracted_metadata ->> 'template_id'
                              else d.extracted_metadata ->> 'document_type' end, ''), 'other') as category
    from public.documents d
   where d.status = 'pending'
)
select patient_id,
       category,
       count(*) as pending_rows,
       (array_agg(id order by created_at, id))[1] as oldest_document_id,
       array_agg(id order by created_at, id) as document_ids,
       min(created_at) as first_created_at,
       max(created_at) as last_created_at
  from classified
 where category <> 'other'
 group by patient_id, category
having count(*) > 1
 order by category, patient_id;
rollback;

-- Part 3 — unclassifiable or silently 'other': pending rows whose category is
-- not a known one, templates with no template_id (the rule treats them as
-- 'other', so they are never checked), and uploads with no document_type
-- (web uploads do not record one; listed so the count is visible).
begin transaction read only;
select d.id as document_id,
       d.patient_id,
       d.file_type,
       d.created_at,
       case
         when d.file_type = 'template' and nullif(d.extracted_metadata ->> 'template_id', '') is null
           then 'template without template_id (treated as other)'
         when d.file_type <> 'template' and nullif(d.extracted_metadata ->> 'document_type', '') is null
           then 'upload without document_type (treated as other)'
         else 'unknown category: ' || case when d.file_type = 'template'
                                           then d.extracted_metadata ->> 'template_id'
                                           else d.extracted_metadata ->> 'document_type' end
       end as reason
  from public.documents d
 where d.status = 'pending'
   and coalesce(nullif(case when d.file_type = 'template'
                            then d.extracted_metadata ->> 'template_id'
                            else d.extracted_metadata ->> 'document_type' end, ''), '(missing)')
       not in ('referral-form', 'lab-request', 'med-cert', 'procedure-consent',
               'patient-intake', 'results-release', 'other')
 order by reason, d.created_at;
rollback;
