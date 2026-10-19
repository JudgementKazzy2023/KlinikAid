// IMPORTANT: This route queries Supabase PostgreSQL directly. No LLM is involved. See SO-C.

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { classifyRead } from "@/lib/read-outcome";

export async function GET(request: Request, props: { params: Promise<{ patientId: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { patientId } = params;

  // Rule 1 check: calling getUser() as the literal first line
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("UNAUTHORIZED: Session not found", 401);
  }

  try {
    await requirePermission("specialist.analytics");

    if (!patientId) {
      return errorResponse("Patient ID is required", 400);
    }

    // The records query below is scoped by patient id, and RLS filters rows out
    // instead of erroring. Without this lookup, another specialist's patient and
    // a patient that does not exist both reach the caller as `200 {"data": []}`,
    // which says "this patient has no data" -- a clinical claim the caller has
    // no evidence for. The matching pages already answer 404 from this same
    // lookup, so the API answers the same way and does not distinguish
    // "not yours" from "not there" (RLS hides both identically).
    const patientRead = classifyRead(
      await supabase.from("specialist_patients").select("id").eq("id", patientId).single()
    );
    if (patientRead.kind === "failed") {
      return handleRouteError(patientRead.error, "Failed to fetch patient metrics");
    }
    if (patientRead.kind === "absent") {
      return errorResponse("Patient not found", 404);
    }

    // Fetch distinct test names for the patient from specialist_records
    const { data: records, error: recordsError } = await supabase
      .from("specialist_records")
      .select("test_name")
      .eq("specialist_patient_id", patientId);

    if (recordsError) {
      throw recordsError;
    }

    const testNames = Array.from(
      new Set((records || []).map((r) => r.test_name).filter(Boolean))
    );

    return successResponse(testNames, "Distinct patient metrics fetched successfully");
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch patient metrics");
  }
}
