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

export const dynamic = "force-dynamic";

// Same joined shape the board renders (ReceptionQueuePage / documents route).
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

/**
 * Search the WHOLE documents table by the fields the board's client filter
 * matches — file name, file type, patient first/last name, uploader full name.
 *
 * The board's initial load is capped (#34), so a client-side filter can only
 * ever see the capped page. This route reaches every row the caller is allowed
 * to see (the caller's RLS-scoped client, not the service role), which is how a
 * referral for a patient whose documents fell outside the cap stays findable.
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

    // 4. Resolve the patient and uploader ids whose names match, so the final
    //    documents query can OR across the file fields and those foreign keys.
    //    PostgREST's `or` cannot span embedded resources, so the name matches
    //    are resolved against their own tables first.
    const [patientsResult, uploadersResult] = await Promise.all([
      supabase
        .from("patients")
        .select("id")
        .or(patientNameConditions(q).join(","))
        .limit(SEARCH_RESULT_LIMIT + 1),
      supabase
        .from("profiles")
        .select("id")
        .or(`full_name.ilike.${pattern}`)
        .limit(SEARCH_RESULT_LIMIT + 1),
    ]);

    // A failure to resolve names is a failed search, never "no name matches":
    // silently dropping patient-name results is the defect this route exists to
    // remove.
    const patients = classifyRead(patientsResult);
    const uploaders = classifyRead(uploadersResult);
    if (patients.kind === "failed") throw patients.error;
    if (uploaders.kind === "failed") throw uploaders.error;

    const patientRows = patients.kind === "ok" ? patients.data ?? [] : [];
    const uploaderRows = uploaders.kind === "ok" ? uploaders.data ?? [] : [];
    // More matching names than the bound means some of their documents may be
    // missing below; report the result as truncated rather than complete.
    const namesTruncated = patientRows.length > SEARCH_RESULT_LIMIT || uploaderRows.length > SEARCH_RESULT_LIMIT;
    const patientIds = patientRows.slice(0, SEARCH_RESULT_LIMIT).map((p) => p.id);
    const uploaderIds = uploaderRows.slice(0, SEARCH_RESULT_LIMIT).map((p) => p.id);

    // 5. The documents query: file name/type, or a patient/uploader whose name
    //    matched. The id lists are UUIDs (no PostgREST-special characters).
    const orParts = [`file_name.ilike.${pattern}`, `file_type.ilike.${pattern}`];
    if (patientIds.length > 0) orParts.push(`patient_id.in.(${patientIds.join(",")})`);
    if (uploaderIds.length > 0) orParts.push(`uploader_id.in.(${uploaderIds.join(",")})`);

    // Fetch one extra to detect the result bound.
    const documentsResult = await supabase
      .from("documents")
      .select(DOCUMENT_SELECT)
      .or(orParts.join(","))
      .order("created_at", { ascending: false })
      .limit(SEARCH_RESULT_LIMIT + 1);

    const documents = classifyRead(documentsResult);
    if (documents.kind === "failed") throw documents.error;

    const rows = documents.kind === "ok" ? documents.data ?? [] : [];
    const truncated = rows.length > SEARCH_RESULT_LIMIT || namesTruncated;

    return successResponse({
      documents: rows.slice(0, SEARCH_RESULT_LIMIT),
      truncated,
    });
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to search documents");
  }
}
