"use server";

import { hasPermission, requireAnyPermission } from "@/lib/auth/helpers";
import { resolveDepartmentScope } from "@/lib/auth/department-scope";
import { LAB_TEST_GROUPS, SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { logEvent } from "@/lib/logger";
import { classifyRead } from "@/lib/read-outcome";
import { extractLabResultValues } from "@/lib/records/extractLabResultValues";
import { matchSheetPatientName } from "@/lib/records/matchSheetPatientName";
import { createClient } from "@/lib/supabase/server";

const MAX_LAB_OCR_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_LAB_OCR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
const FREE_TEXT_OCR_DEPARTMENTS = new Set(["imaging", "ultrasound", "ecg"]);
const FREE_TEXT_OCR_TARGETS = new Set(["findings", "impression"]);
const OCR_FAILURE_PHRASES = [
  "cannot extract",
  "unable to extract",
  "too blurry",
  "cannot read",
  "unable to read",
  "illegible",
  "i am sorry",
  "no text",
];

/**
 * Whose sheet the OCR read, decided here rather than in the browser (#60).
 *
 * The extracted values live inside the identity branches that may apply them,
 * so the client cannot reach the values without first handling who the sheet
 * names. A sheet with no readable name carries no values at all: it goes to
 * manual entry.
 */
export type LabOcrIdentity =
  | { kind: "match"; panel: string | null; values: Record<string, string> }
  | {
      kind: "mismatch";
      sheetPatientName: string;
      openPatientName: string;
      panel: string | null;
      values: Record<string, string>;
    }
  | { kind: "unconfirmed" };

export type ExtractLabResultValuesActionResult =
  | { success: false; error: string }
  | { success: true; identity: LabOcrIdentity; sheetDate: string | null };

export interface ExtractDepartmentTextActionResult {
  success: boolean;
  error?: string;
  text?: string;
}

function isUnreadableOcrText(text: string | null | undefined) {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized || normalized === "ocr_failed") return true;
  return OCR_FAILURE_PHRASES.some((phrase) => normalized.includes(phrase));
}

export async function extractLabResultValuesAction(
  formData: FormData
): Promise<ExtractLabResultValuesActionResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);
    // The department follows permissions, not the legacy role text: an
    // own_department caller is pinned to its own department even if it posts a
    // different one in the form.
    const scope = resolveDepartmentScope({
      requestedDepartment: formData.get("department"),
      ownDepartment: profile.department,
      canSelectDepartment: await hasPermission(profile.id, "records.manage"),
    });

    if (scope.kind !== "scoped") {
      return {
        success: false,
        error:
          scope.kind === "missing_department"
            ? "Your account is not assigned to a department."
            : "Select a valid department.",
      };
    }

    if (scope.department !== "laboratory") {
      return { success: false, error: "OCR lab value extraction is available only for laboratory records." };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "Upload a laboratory result sheet before extracting values." };
    }

    if (!ALLOWED_LAB_OCR_MIME_TYPES.has(file.type)) {
      return { success: false, error: "Only PDF, JPG, or PNG result sheets are supported." };
    }

    if (file.size > MAX_LAB_OCR_FILE_SIZE) {
      return { success: false, error: "Result sheet must be 5MB or smaller." };
    }

    const patientId = String(formData.get("patientId") || "");
    if (!patientId) {
      return { success: false, error: "Open a patient before extracting values." };
    }

    // The open patient's name is what the sheet is checked against. A failed read
    // is not "no name to compare" -- it means the check cannot be made, so no
    // values are returned at all.
    const patientRead = classifyRead(
      await supabase.from("patients").select("first_name, last_name").eq("id", patientId).single()
    );
    if (patientRead.kind === "absent") {
      return {
        success: false,
        error: "This patient could not be found, so the result sheet could not be checked. No values were applied.",
      };
    }
    const patient = patientRead.kind === "ok" ? patientRead.data : null;
    if (!patient) {
      console.error(
        "[extractLabResultValuesAction] Failed to load the open patient:",
        patientRead.kind === "failed" ? patientRead.error : "no row returned"
      );
      return {
        success: false,
        error: "Could not load this patient to check the result sheet against. No values were applied; try again.",
      };
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extractionResult = await extractLabResultValues(fileBuffer, file.type);

    if (!extractionResult) {
      return { success: false, error: "Unable to extract structured lab values from this file." };
    }

    const nameMatch = matchSheetPatientName(extractionResult.sheetPatientName, patient);
    let identity: LabOcrIdentity;
    if (nameMatch.kind === "match") {
      identity = { kind: "match", panel: extractionResult.panel, values: extractionResult.values };
    } else if (nameMatch.kind === "mismatch" && extractionResult.sheetPatientName) {
      identity = {
        kind: "mismatch",
        sheetPatientName: extractionResult.sheetPatientName,
        openPatientName: `${patient.first_name} ${patient.last_name}`,
        panel: extractionResult.panel,
        values: extractionResult.values,
      };
    } else {
      identity = { kind: "unconfirmed" };
    }

    try {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.LAB_RESULT_OCR_PROCESSED,
        "Lab result values extracted via Google Generative AI",
        null,
        {
          patient_id: patientId,
          panel: extractionResult.panel,
          patient_identity: identity.kind,
          extracted_value_count: Object.keys(extractionResult.values).length,
          prompt_token_count: extractionResult.promptTokenCount,
          candidates_token_count: extractionResult.candidatesTokenCount,
          total_token_count: extractionResult.totalTokenCount,
        }
      );
    } catch (logError) {
      console.error("[extractLabResultValuesAction] Non-blocking OCR event logging error:", logError);
    }

    return {
      success: true,
      identity,
      sheetDate: extractionResult.sheetDate,
    };
  } catch (error) {
    console.error("[extractLabResultValuesAction] Failed to extract lab result values:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract lab result values.",
    };
  }
}

/**
 * Record that an operator applied OCR values after being told the sheet names a
 * different patient. Only the fact of the override is stored -- the open
 * patient, the panel and how many fields were filled -- never the values or the
 * other name on the sheet.
 */
export async function logLabOcrIdentityOverrideAction(input: {
  patientId: string;
  panel: string;
  appliedCount: number;
}): Promise<{ logged: boolean }> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { logged: false };
  }

  try {
    await requireAnyPermission(["records.manage", "records.manage.own_dept"]);

    // The patient id comes from the browser. Only attest an override for a
    // patient this caller can actually read, the same read the extraction made.
    const patientRead = classifyRead(
      await supabase.from("patients").select("id").eq("id", String(input.patientId)).single()
    );
    if (patientRead.kind !== "ok" || !patientRead.data) {
      return { logged: false };
    }

    const outcome = await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.LAB_RESULT_OCR_IDENTITY_OVERRIDE,
      "Lab OCR values applied although the result sheet names a different patient",
      null,
      {
        patient_id: patientRead.data.id,
        panel: input.panel in LAB_TEST_GROUPS ? input.panel : null,
        applied_value_count: Number.isInteger(input.appliedCount) ? input.appliedCount : null,
      }
    );
    return { logged: outcome.ok };
  } catch (error) {
    console.error("[logLabOcrIdentityOverrideAction] Failed to log OCR identity override:", error);
    return { logged: false };
  }
}

export async function extractDepartmentTextAction(
  formData: FormData
): Promise<ExtractDepartmentTextActionResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const profile = await requireAnyPermission(["records.manage", "records.manage.own_dept"]);
    const scope = resolveDepartmentScope({
      requestedDepartment: formData.get("department"),
      ownDepartment: profile.department,
      canSelectDepartment: await hasPermission(profile.id, "records.manage"),
    });

    if (scope.kind !== "scoped") {
      return {
        success: false,
        error:
          scope.kind === "missing_department"
            ? "Your account is not assigned to a department."
            : "Select a valid department.",
      };
    }

    const effectiveDepartment = scope.department;
    const targetField = String(formData.get("targetField") || "");

    if (effectiveDepartment === "laboratory") {
      return { success: false, error: "Use lab value OCR for laboratory records." };
    }

    if (!FREE_TEXT_OCR_DEPARTMENTS.has(String(effectiveDepartment))) {
      return {
        success: false,
        error: "Text OCR is available only for Imaging, Ultrasound, and ECG records.",
      };
    }

    if (!FREE_TEXT_OCR_TARGETS.has(targetField)) {
      return { success: false, error: "Select where to place the extracted text." };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "Upload a result sheet before extracting text." };
    }

    if (!ALLOWED_LAB_OCR_MIME_TYPES.has(file.type)) {
      return { success: false, error: "Only PDF, JPG, or PNG result sheets are supported." };
    }

    if (file.size > MAX_LAB_OCR_FILE_SIZE) {
      return { success: false, error: "Result sheet must be 5MB or smaller." };
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const extractionResult = await extractDocumentText(fileBuffer, file.type);

    if (!extractionResult) {
      return {
        success: false,
        error: "Unable to extract readable text from this file. Please review the image quality and try again.",
      };
    }

    const extractedText = (extractionResult.text || "").trim();
    const isUnreadable = isUnreadableOcrText(extractedText);

    try {
      await logEvent(
        supabase,
        user.id,
        SYSTEM_EVENT_TYPES.DEPARTMENT_TEXT_OCR_PROCESSED,
        "Department text extracted via Google Generative AI",
        null,
        {
          department: effectiveDepartment,
          target_field: targetField,
          prompt_token_count: extractionResult.promptTokenCount,
          candidates_token_count: extractionResult.candidatesTokenCount,
          total_token_count: extractionResult.totalTokenCount,
          extracted_char_count: isUnreadable ? 0 : extractedText.length,
          extraction_status: isUnreadable ? "unreadable" : "success",
        }
      );
    } catch (logError) {
      console.error("[extractDepartmentTextAction] Non-blocking OCR event logging error:", logError);
    }

    if (isUnreadable) {
      return {
        success: false,
        error: "Could not extract readable text from this file. Upload a clearer image or enter the text manually.",
      };
    }

    return {
      success: true,
      text: extractedText,
    };
  } catch (error) {
    console.error("[extractDepartmentTextAction] Failed to extract department text:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract department text.",
    };
  }
}
