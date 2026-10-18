import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { openQueueEntryDepartment, queueNumberFromTriageNotes } from "@/lib/queue-number";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import type { Patient, PatientQueue } from "@/types";

// The row triage_patient() returns, with the patient embedded as selected below.
type TriagedQueueEntry = Omit<PatientQueue, "patient"> & {
  queue_date: string;
  queue_number: number;
  patient: Pick<Patient, "id" | "first_name" | "last_name"> | null;
};

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;
const BLOOD_PRESSURE_REGEX = /^\d{2,3}\/\d{2,3}$/;

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseOptionalWeight(value: unknown): { valid: boolean; value: number | null; error?: string } {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return { valid: true, value: null };

  if (!STRICT_NUMBER_REGEX.test(normalized)) {
    return { valid: false, value: null, error: "Weight must be a valid positive number below 500 kg." };
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue >= 500) {
    return { valid: false, value: null, error: "Weight must be a valid positive number below 500 kg." };
  }

  return { valid: true, value: numericValue };
}

function parseOptionalTemperature(value: unknown): { valid: boolean; value: number | null; error?: string } {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return { valid: true, value: null };

  if (!STRICT_NUMBER_REGEX.test(normalized)) {
    return { valid: false, value: null, error: "Temperature must be between 30°C and 45°C." };
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 30 || numericValue > 45) {
    return { valid: false, value: null, error: "Temperature must be between 30°C and 45°C." };
  }

  return { valid: true, value: numericValue };
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // 1. Session Check (Rule 1)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role Check (Rule 2)
    const profile = await requirePermission("queue.manage");

    // 3. Parse and validate body
    const body = await request.json();
    const { patient_id, department, notes, vitals, priority_level } = body;

    if (!patient_id) {
      return errorResponse("patient_id is required", 400);
    }
    if (!department || !["laboratory", "imaging", "ultrasound", "ecg"].includes(department)) {
      return errorResponse("Valid department ('laboratory', 'imaging', 'ultrasound', 'ecg') is required", 400);
    }

    const bloodPressure = normalizeOptionalString(vitals?.blood_pressure);
    if (bloodPressure && !BLOOD_PRESSURE_REGEX.test(bloodPressure)) {
      return errorResponse("Blood pressure format must be e.g. 120/80", 400);
    }

    const weight = parseOptionalWeight(vitals?.weight_kg);
    if (!weight.valid) {
      return errorResponse(weight.error || "Invalid weight.", 400);
    }

    const temperature = parseOptionalTemperature(vitals?.temperature_c);
    if (!temperature.valid) {
      return errorResponse(temperature.error || "Invalid temperature.", 400);
    }

    // 4. Route the patient in one database call (migration 33).
    // triage_patient() refuses a patient who already has an open (waiting or
    // in_progress) entry, allocates the department's next number for the
    // Philippine (UTC+8) day, and inserts the entry, all in one transaction. It
    // used to be three requests -- open-entry check, count(today)+1, insert -- so
    // concurrent triage passed the check together and read the same count:
    // different patients got the same number, and one patient could be queued
    // several times. Unique indexes now back both rules. The function is
    // SECURITY INVOKER, so the insert is still governed by the queue RLS
    // policies, and it re-checks queue.manage itself.
    const { data: queueEntry, error: triageError } = await supabase
      .rpc("triage_patient", {
        p_patient_id: patient_id,
        p_department: department,
        p_priority_level: priority_level || "routine",
        p_vitals: {
          blood_pressure: bloodPressure || null,
          weight_kg: weight.value,
          temperature_c: temperature.value,
        },
        p_notes: notes || "",
      })
      .select(`
        *,
        patient:patient_id (
          id,
          first_name,
          last_name
        )
      `)
      .single<TriagedQueueEntry>();

    const openDepartment = openQueueEntryDepartment(triageError);
    if (openDepartment !== null) {
      // Map department identifier to a human-readable title
      const deptNames: Record<string, string> = {
        laboratory: "Laboratory",
        imaging: "Imaging",
        ultrasound: "Ultrasound",
        ecg: "ECG",
      };
      const deptLabel = deptNames[openDepartment] || openDepartment;
      return errorResponse(
        `Patient already in ${deptLabel} queue. Resolve the existing entry before routing a new one.`,
        409
      );
    }

    if (triageError || !queueEntry) {
      throw triageError || new Error("Failed to insert queue record");
    }

    // The number the queue boards show: read back from the triage_notes the
    // function wrote, rather than formatted a second time here.
    const queueNumber = queueNumberFromTriageNotes(queueEntry.triage_notes);

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.TRIAGE_COMPLETED,
      `Patient ${queueEntry.patient?.first_name} ${queueEntry.patient?.last_name} routed to ${department} with queue #${queueNumber}`,
      null,
      {
        queue_id: queueEntry.id,
        patient_id,
        department,
        queue_number: queueNumber,
        assigned_by: user.id,
        assigned_by_name: profile.full_name,
      }
    );

    // Return the response including the queue entry and computed queue_number
    return successResponse(
      {
        ...queueEntry,
        queue_number: queueNumber,
      },
      "Patient routed and triaged successfully"
    );
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to complete triage routing");
  }
}
