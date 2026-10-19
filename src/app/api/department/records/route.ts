import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, requireAnyPermission } from "@/lib/auth/helpers";
import { resolveDepartmentScope } from "@/lib/auth/department-scope";
import { ValidationError, errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { resultValueText, validateLabSubmission } from "@/lib/records/validateLabResult";
import { validateNotes } from "@/lib/validation";

export async function GET(request: Request) {
  const supabase = await createClient();

  try {
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

    // Determine target department from permissions, not profiles.role: only a
    // holder of the unscoped permission may choose one. A caller limited to
    // records.manage.own_dept, including a custom role, is pinned to its own
    // department and any ?department= it sends is ignored.
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

    // Fetch department records with patient details
    const { data: records, error: recordsError } = await supabase
      .from("department_records")
      .select(`
        id,
        patient_id,
        recorder_id,
        department,
        test_type,
        test_name,
        test_value,
        unit,
        reference_range_min,
        reference_range_max,
        is_flagged,
        notes,
        created_at,
        patient:patient_id (
          id,
          first_name,
          last_name
        ),
        recorder:recorder_id (
          id,
          full_name
        )
      `)
      .eq("department", dept)
      .order("created_at", { ascending: false });

    if (recordsError) {
      throw recordsError;
    }

    return successResponse(records || [], "Department records retrieved successfully");
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to fetch department records");
  }
}

interface TestResultInput {
  test_name: string;
  test_value: string | number;
  unit?: string | null;
  reference_range_min?: number | string | null;
  reference_range_max?: number | string | null;
  is_flagged?: boolean;
}

interface DepartmentRecordRow {
  patient_id: string;
  recorder_id: string;
  department: string;
  test_type: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // 1. Session Check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role Check (Only admins or department_staff can enter results)
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

    // 3. Parse request body
    const body = await request.json();
    const { patient_id, test_type, notes } = body;
    const results = body.results as TestResultInput[];

    if (!patient_id) {
      return errorResponse("patient_id is required", 400);
    }
    // Checked for every department, not only laboratory: a non-lab submission
    // passes test_type straight into the insert.
    if (typeof test_type !== "string" || !test_type.trim()) {
      return errorResponse("test_type is required and must be a string", 400);
    }
    if (!results || !Array.isArray(results) || results.length === 0) {
      return errorResponse("results array is required and must not be empty", 400);
    }

    // Notes are a short clinical annotation, not a document: trim and bound them
    // so the 5,034-character values the QA pass found cannot be stored.
    const notesCheck = validateNotes(notes);
    if (!notesCheck.valid) {
      return errorResponse(notesCheck.error || "Invalid notes.", 400);
    }
    const normalizedNotes = typeof notes === "string" ? notes.trim() : null;

    // Determine department from permissions, not profiles.role. A caller
    // limited to records.manage.own_dept cannot choose a department by putting
    // one in the body; its own department wins.
    const scope = resolveDepartmentScope({
      requestedDepartment: body.department,
      ownDepartment: profile.department,
      canSelectDepartment: await hasPermission(profile.id, "records.manage"),
    });

    if (scope.kind !== "scoped") {
      return errorResponse("Valid department assignment is required", 400);
    }

    // A pinned caller that names another department would otherwise have its
    // results filed under its own department instead. Refuse rather than
    // misfile them.
    if (
      typeof body.department === "string" &&
      body.department.trim() !== "" &&
      body.department.trim() !== scope.department
    ) {
      return errorResponse("You can only record results for your own department", 403);
    }

    const dept = scope.department;

    let patientGender: string | null = null;
    if (dept === "laboratory") {
      const { data: patient, error: patientError } = await supabase
        .from("patients")
        .select("gender")
        .eq("id", patient_id)
        .single();

      if (patientError || !patient) {
        return errorResponse("Patient record not found", 404);
      }

      patientGender = patient.gender;
    }

    // 4. Format rows for bulk relational insert. Bad input throws a
    // ValidationError, which handleRouteError answers with 400 and its message.
    // A laboratory test_type is either a structured panel or a narrative test.
    const rowsToInsert: DepartmentRecordRow[] =
      dept === "laboratory"
        ? validateLabSubmission(test_type, results, patientGender).map((validated) => ({
            patient_id,
            recorder_id: user.id,
            department: dept,
            test_type,
            test_name: validated.test_name,
            test_value: validated.test_value,
            unit: validated.unit,
            reference_range_min: validated.reference_range_min,
            reference_range_max: validated.reference_range_max,
            is_flagged: validated.is_flagged,
            notes: normalizedNotes || null
          }))
        : results.map((res) => {
            if (typeof res?.test_name !== "string" || !res.test_name) {
              throw new ValidationError("Each result must have a test_name");
            }
            const testValue = resultValueText(res.test_value);
            if (testValue === null) {
              throw new ValidationError(
                `test_value for ${res.test_name} is required and must be a string or a number`
              );
            }

            return {
              patient_id,
              recorder_id: user.id,
              department: dept,
              test_type,
              test_name: res.test_name,
              test_value: testValue,
              unit: res.unit || null,
              reference_range_min: null,
              reference_range_max: null,
              is_flagged: false,
              notes: normalizedNotes || null
            };
          });

    // 5. Perform insert
    const { data: insertedData, error: insertError } = await supabase
      .from("department_records")
      .insert(rowsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    // 6. Update the patient's open queue entry for this department to 'completed'.
    //
    // Deliberately NOT filtered by date. This query used to require
    // `created_at >= start-of-PHT-today` while the department's queue list had
    // the same filter and reception's re-triage guard had none. An entry opened
    // before PHT midnight was invisible to the department, un-re-triable, and
    // could never be closed by this path. All three must stay unfiltered so that
    // "blocks reception" and "is actionable by the department" stay equivalent.
    //
    // These two writes are NOT atomic. The results above are already committed
    // by the time this runs, so a failure here cannot be rolled back and must
    // not be reported as if the whole operation succeeded -- see the response
    // below. Making this atomic needs a Postgres function taking both writes
    // together, in the shape of `archive_specialist_patient` from
    // migration_22; that is tracked separately because it requires DDL.
    const { data: updatedQueue, error: queueError } = await supabase
      .from("patient_queue")
      .update({
        status: "completed",
        updated_at: new Date().toISOString()
      })
      .eq("patient_id", patient_id)
      .eq("department", dept)
      .in("status", ["waiting", "in_progress"])
      .select("id");

    if (queueError) {
      console.error("Warning: Failed to update patient queue status:", queueError);
    }

    const completedCount = updatedQueue?.length || 0;

    // 7. Log audit trail events
    const flaggedCount = rowsToInsert.filter((r) => r.is_flagged).length;
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.RECORD_ENTERED,
      `Entered results for patient in ${dept} department. Total tests: ${results.length}, Flagged: ${flaggedCount}`,
      null,
      {
        patient_id,
        department: dept,
        test_type,
        flagged_count: flaggedCount,
        total_count: results.length
      }
    );

    if (completedCount > 0) {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.QUEUE_COMPLETED,
        `Patient queue entry marked completed for ${dept} department. Updated rows: ${completedCount}`,
        null,
        {
          patient_id,
          department: dept,
          completed_count: completedCount
        }
      );
    }

    // The client cannot tell a partial success from a full one unless the
    // response says which happened. Two distinct outcomes, both of which used to
    // reach the technologist as "saved and queue updated successfully!":
    //
    //   - the update errored, so the patient is still queued and open;
    //   - the update matched no row, so there was no open entry to close, which
    //     usually means the patient was never routed to this department.
    //
    // Both leave reception blocked from re-triaging by the 409 guard, so both are
    // reported rather than assumed away. The records themselves did save, so the
    // status stays 201 -- returning 500 here would invite a retry that
    // duplicates every result row.
    return NextResponse.json(
      {
        success: true,
        message:
          completedCount > 0
            ? "Department records saved successfully"
            : "Department records saved, but the patient's queue entry was not closed",
        data: {
          records: insertedData,
          queue: {
            department: dept,
            completed_count: completedCount,
            closed: completedCount > 0,
            // True when the update ran cleanly but matched no open entry.
            matched_open_entry: completedCount > 0,
            // Set when the update itself failed.
            error: queueError
              ? "The queue update failed. The patient is still listed as open for this department."
              : null,
          },
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to save department records");
  }
}
