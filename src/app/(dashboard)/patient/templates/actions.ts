"use server";

import { createClient } from "@/lib/supabase/server";
import { privacyConsentError } from "@/lib/auth/privacy-consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { validateAge } from "@/lib/validation";
import { CLINIC_TEMPLATES } from "@/lib/documentTemplates";
import {
  templateDocument,
  templateRequestFingerprint,
  validateTemplateSubmission
} from "@/lib/documents/templateChecks";

export interface TemplateSubmitResult {
  success: boolean;
  error?: string;
  documentId?: string;
}

export async function submitTemplateDocumentAction(
  templateId: string,
  templateName: string,
  fieldsPayload: Record<string, string>
): Promise<TemplateSubmitResult> {
  const supabase = await createClient();

  try {
    // 1. Authenticate patient session (Rule 1 & Rule 9)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Unauthorized: Please log in." };
    }

    const consentError = await privacyConsentError(supabase, user.id);
    if (consentError) {
      return { success: false, error: consentError };
    }

    // 2. Get corresponding patient record along with profile information
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("id, first_name, last_name, date_of_birth, contact_number, address")
      .eq("profile_id", user.id)
      .single();

    if (patientError || !patient) {
      return { success: false, error: "Patient profile is not configured. Contact clinic staff." };
    }

    const patientDob = patient.date_of_birth || "";

    const template = CLINIC_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      return { success: false, error: "Unknown template selected." };
    }

    const fieldsValidation = validateTemplateSubmission(template, fieldsPayload);
    if (!fieldsValidation.valid) {
      return { success: false, error: fieldsValidation.error };
    }

    // Server-side age validation for intake forms
    if (templateId === "patient-intake") {
      const ageValidation = validateAge(patientDob);
      if (!ageValidation.valid) {
        return {
          success: false,
          error: ageValidation.error || "Submission restricted: age must be 18 or above."
        };
      }
    }

    // 3. Document, DOCUMENT_SUBMITTED event, receipt and the one-pending-per-
    // category rule in one transaction (migration_41), shared with the mobile
    // patient-document-submission function. Service role: patients hold no
    // INSERT policy on documents (migration_23). Each web submit is a new
    // request; the duplicate rule is what stops a double click.
    const built = templateDocument(template, fieldsValidation.fields, patient);
    const { data: outcome, error: submitError } = await createAdminClient().rpc("submit_patient_template", {
      p_user_id: user.id,
      p_request_id: crypto.randomUUID(),
      p_fingerprint: await templateRequestFingerprint(template.id, fieldsValidation.fields),
      p_patient_id: patient.id,
      p_file_name: built.file_name,
      p_file_path: built.file_path,
      p_metadata: built.extracted_metadata,
      p_description: `Patient submitted form template: ${template.name}`
    });

    if (submitError) {
      throw submitError;
    }

    if (outcome?.outcome === "duplicate") {
      return {
        success: false,
        error: `You already have a pending ${template.name}. Wait for the clinic to review it, or cancel it from My Submissions.`,
        documentId: outcome.document_id
      };
    }

    if (outcome?.outcome !== "created" || !outcome.document_id) {
      throw new Error("Unexpected template submission outcome.");
    }

    revalidatePath("/patient/submissions");
    return { success: true, documentId: outcome.document_id };
  } catch (err: unknown) {
    console.error("Failed to submit form template:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to submit form template."
    };
  }
}
