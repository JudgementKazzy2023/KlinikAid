import { createClient } from "@/lib/supabase/server";
import { hasPermission, requireAnyPermission } from "@/lib/auth/helpers";
import { resolveDepartmentScope } from "@/lib/auth/department-scope";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";

export async function GET(request: Request) {
  const supabase = await createClient();

  try {
    // 1. Enforce the permission that guards the department queue
    const profile = await requireAnyPermission(["queue.manage", "queue.manage.own_dept"]);

    // 2. Determine target department from permissions, not profiles.role: only
    // a holder of the unscoped permission may choose a department. Anyone
    // holding only queue.manage.own_dept is pinned to their own department,
    // whatever the legacy role text says.
    const { searchParams } = new URL(request.url);
    const scope = resolveDepartmentScope({
      requestedDepartment: searchParams.get("department"),
      ownDepartment: profile.department,
      canSelectDepartment: await hasPermission(profile.id, "queue.manage"),
    });

    if (scope.kind === "missing_department") {
      return errorResponse("Staff member is not assigned to a department", 400);
    }
    if (scope.kind === "invalid_department") {
      return errorResponse("Invalid department requested", 400);
    }

    const dept = scope.department;

    // 4. Fetch the department's open queue entries, regardless of age.
    // Must stay consistent with the queue list in
    // src/app/(dashboard)/department/records/page.tsx and the completion update
    // in src/app/api/department/records/route.ts: all three are unfiltered by
    // date, so an entry that blocks reception is always one the department can
    // see and close. See that page for the full account of the deadlock.
    const { data: queue, error: queueError } = await supabase
      .from("patient_queue")
      .select(`
        id,
        patient_id,
        department,
        status,
        priority_level,
        triage_notes,
        created_at,
        patient:patient_id (
          id,
          first_name,
          last_name,
          gender,
          date_of_birth
        )
      `)
      .eq("department", dept)
      .in("status", ["waiting", "in_progress"])
      .order("created_at", { ascending: true });

    if (queueError) {
      throw queueError;
    }

    return successResponse(queue || [], "Queue retrieved successfully");
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch department queue");
  }
}
