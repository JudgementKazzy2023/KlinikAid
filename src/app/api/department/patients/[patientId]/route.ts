import { createClient } from "@/lib/supabase/server";
import { hasPermission, requireAnyPermission } from "@/lib/auth/helpers";
import { resolveDepartmentScope } from "@/lib/auth/department-scope";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";

export async function GET(request: Request, props: { params: Promise<{ patientId: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { patientId } = params;

  if (!patientId) {
    return errorResponse("patientId parameter is required", 400);
  }

  try {
    // 1. Enforce the permission that guards department records
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

    // 2. Determine target department from permissions, not profiles.role: a
    // caller limited to records.manage.own_dept may not widen the request with
    // ?department=, so its own department is the only history it can read.
    const { searchParams } = new URL(request.url);
    const scope = resolveDepartmentScope({
      requestedDepartment: searchParams.get("department"),
      ownDepartment: profile.department,
      canSelectDepartment: await hasPermission(profile.id, "records.manage"),
    });

    if (scope.kind === "missing_department") {
      return errorResponse("Staff member is not assigned to a department", 400);
    }
    if (scope.kind === "invalid_department") {
      return errorResponse("Invalid department requested", 400);
    }

    const dept = scope.department;

    // 3. Fetch patient demographics
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .single();

    if (patientError || !patient) {
      return errorResponse("Patient not found", 404, patientError?.message);
    }

    // 4. Fetch patient's history for this department
    const { data: history, error: historyError } = await supabase
      .from("department_records")
      .select(`
        id,
        test_type,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        recorder:recorder_id (
          id,
          full_name
        )
      `)
      .eq("patient_id", patientId)
      .eq("department", dept)
      .order("created_at", { ascending: false });

    if (historyError) {
      throw historyError;
    }

    return successResponse(
      {
        patient,
        history: history || []
      },
      "Patient data and history retrieved successfully"
    );
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch patient details");
  }
}
