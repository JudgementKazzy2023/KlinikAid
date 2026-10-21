import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { classifyRead } from "@/lib/read-outcome";
import {
  buildSearchPattern,
  patientNameConditions,
  MAX_SEARCH_TERM_LENGTH,
  SEARCH_RESULT_LIMIT,
} from "@/lib/reception-search";
import type { Document } from "@/types";

export const dynamic = "force-dynamic";

// Same joined shape the board renders (ReceptionQueuePage / documents route).
// Written out once per branch rather than generated from a helper: supabase-js
// parses the select string at the type level, and a generated string degrades
// every row type to a parse error. The `!inner` variants are used by the
// name-search branches, where the join itself is the filter: a filtered inner
// join restricts the parent rows to those whose related row matches. The plain
// file-field branch must NOT inner-join, or documents whose patient row is
// absent (patient_id is nullable) would drop out of file-name matches.
const DOCUMENT_SELECT = `
  *,
  patient:patient_id (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    email,
    address
  ),
  uploader:uploader_id (
    id,
    full_name,
    role
  )
`;

const DOCUMENT_SELECT_BY_PATIENT = `
  *,
  patient:patient_id!inner (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    email,
    address
  ),
  uploader:uploader_id (
    id,
    full_name,
    role
  )
`;

const DOCUMENT_SELECT_BY_UPLOADER = `
  *,
  patient:patient_id (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    contact_number,
    email,
    address
  ),
  uploader:uploader_id!inner (
    id,
    full_name,
    role
  )
`;

/**
 * Search the WHOLE documents table by the fields the board's client filter
 * matches — file name, file type, patient first/last name, uploader full name.
 *
 * The board's initial load is capped (#34), so a client-side filter can only
 * ever see the capped page. This route reaches every row the caller is allowed
 * to see (the caller's RLS-scoped client, not the service role), which is how a
 * referral for a patient whose documents fell outside the cap stays findable.
 *
 * The name conditions are applied to the documents table itself, through
 * `!inner` embedded-resource filters, instead of resolving matching names to
 * foreign keys first. Resolving first needs a cap on the name list, and a name
 * past that cap silently loses every document that belongs only to it — the
 * route can then answer "no match" while claiming completeness (#129).
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  // 1. Session check — literal first operation.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Same permission as the board itself.
    await requirePermission("documents.manage");

    // 3. Bound the term.
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (q.length < 1 || q.length > MAX_SEARCH_TERM_LENGTH) {
      return errorResponse("Search term must be between 1 and 100 characters.", 400);
    }

    const pattern = buildSearchPattern(q);

    // 4. Three parallel branches over `documents`. PostgREST's `or` cannot
    //    span an embedded resource (a filter like
    //    `or=(file_name.imatch.x,patient.first_name.imatch.x)` is rejected at
    //    parse time), so each field group gets its own branch. The name
    //    branches inner-join their table and put the name conditions on the
    //    embedded resource (`patient.or=…`), which PostgREST evaluates as a
    //    correlated EXISTS over every row the caller can see — no name list,
    //    and therefore no name cap, exists at all.
    //
    //    Each branch fetches one extra row to detect its own bound. A branch
    //    under that bound has returned all of its matches, so the union below
    //    is the complete match set unless a branch hit its bound — and that
    //    case is reported as truncated, never as a complete answer.
    const [filesResult, byPatientResult, byUploaderResult] = await Promise.all([
      supabase
        .from("documents")
        .select(DOCUMENT_SELECT)
        .or(`file_name.imatch.${pattern},file_type.imatch.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT + 1),
      supabase
        .from("documents")
        .select(DOCUMENT_SELECT_BY_PATIENT)
        .or(patientNameConditions(q).join(","), { referencedTable: "patient" })
        .order("created_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT + 1),
      supabase
        .from("documents")
        .select(DOCUMENT_SELECT_BY_UPLOADER)
        .or(`full_name.imatch.${pattern}`, { referencedTable: "uploader" })
        .order("created_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT + 1),
    ]);

    // A branch that failed is a failed search, never a branch with no matches:
    // a missing branch would under-report results while the response still
    // claims to be complete.
    const branches = [classifyRead(filesResult), classifyRead(byPatientResult), classifyRead(byUploaderResult)];
    for (const branch of branches) {
      if (branch.kind === "failed") throw branch.error;
    }

    // 5. Merge newest-first, de-duplicated: one document can match several
    //    branches (a file name that also matches a patient name) and must be
    //    listed once.
    const merged = new Map<string, Document>();
    for (const branch of branches) {
      const rows: Document[] = branch.kind === "ok" ? branch.data ?? [] : [];
      for (const row of rows) {
        merged.set(row.id, row);
      }
    }
    const matches = [...merged.values()].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );

    // Every branch that was not cut off at its extra row returned all of its
    // matches, so the union above is complete unless it is larger than the
    // final cap. `truncated` therefore means exactly "some matches were left
    // out", and it is false only for a genuinely complete search.
    const truncated = matches.length > SEARCH_RESULT_LIMIT;

    return successResponse({
      documents: matches.slice(0, SEARCH_RESULT_LIMIT),
      truncated,
    });
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to search documents");
  }
}
