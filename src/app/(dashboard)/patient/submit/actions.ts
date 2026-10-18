"use server";

import { createClient } from "@/lib/supabase/server";
import { privacyConsentError } from "@/lib/auth/privacy-consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/logger";
import { extractDocumentText } from "@/lib/documents/extractDocumentText";
import { detectRequestedTests, selectDetectedTests } from "@/lib/documents/detectRequestedTests";
import { revalidatePath } from "next/cache";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { classifyRead } from "@/lib/read-outcome";
import { finalDocumentPath } from "@/lib/documents/assessedDocument";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const DOCUMENT_BUCKET = "patient-documents";
const OCR_FAILURE_TOKEN = "OCR_FAILED";
const ASSESSMENT_EXPIRED_ERROR = "Document assessment expired or was not found. Please upload the file again.";
const OCR_FAILURE_PHRASES = [
  "cannot extract",
  "can't extract",
  "unable to extract",
  "cannot read",
  "can't read",
  "unable to read",
  "i am sorry",
  "i'm sorry",
  "too blurry",
  "blurry",
  "illegible",
  "not legible",
  "no readable text",
  "no text",
];

interface PendingDocumentOcrRow {
  id: string;
  patient_id: string;
  file_name: string;
  file_type: string;
  file_path: string;
  ocr_text: string;
}

function validateAssessmentId(assessmentId: unknown): assessmentId is string {
  return typeof assessmentId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assessmentId);
}

function getFileExtension(fileName: string, fileType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension) return extension;
  if (fileType === "application/pdf") return "pdf";
  if (fileType === "image/png") return "png";
  return "jpg";
}

async function getPatientForCurrentUser(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", userId)
    .single();

  if (patientError || !patient) {
    return { patient: null, error: "Patient profile is not configured. Contact clinic staff." };
  }

  return { patient, error: null };
}

function validateUploadedFile(file: File | null) {
  if (!file || file.size === 0) {
    return "No file provided.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "File exceeds the 5MB size limit.";
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Only PDF, JPG, and PNG files are allowed.";
  }

  return null;
}

function isPoorQualityOcrText(text: string) {
  const normalizedText = text.trim().toLowerCase();

  if (!normalizedText) {
    return true;
  }

  if (normalizedText === OCR_FAILURE_TOKEN.toLowerCase()) {
    return true;
  }

  return OCR_FAILURE_PHRASES.some((phrase) => normalizedText.includes(phrase));
}

export async function assessDocumentQualityAction(formData: FormData) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  const consentError = await privacyConsentError(supabase, user.id);
  if (consentError) {
    return { success: false, error: consentError };
  }

  const { patient, error: patientError } = await getPatientForCurrentUser(supabase, user.id);
  if (patientError || !patient) {
    return { success: false, error: patientError };
  }

  const file = formData.get("file") as File | null;
  const validationError = validateUploadedFile(file);
  if (validationError || !file) {
    return { success: false, error: validationError || "Invalid file." };
  }

  const assessmentId = crypto.randomUUID();
  const fileExtension = getFileExtension(file.name, file.type);
  const pendingFilePath = `${user.id}/pending-submissions/${assessmentId}/source.${fileExtension}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(pendingFilePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[assessDocumentQualityAction] Pending file upload error:", uploadError);
    return { success: false, error: `Failed to upload file for assessment: ${uploadError.message}` };
  }

  let ocrText = "";
  let promptTokenCount: number | null = null;
  let candidatesTokenCount: number | null = null;
  let totalTokenCount: number | null = null;

  try {
    const extractionResult = await extractDocumentText(fileBuffer, file.type);
    if (extractionResult) {
      ocrText = extractionResult.text || "";
      promptTokenCount = extractionResult.promptTokenCount;
      candidatesTokenCount = extractionResult.candidatesTokenCount;
      totalTokenCount = extractionResult.totalTokenCount;

      try {
        await logEvent(
          supabase,
          user.id,
          SYSTEM_EVENT_TYPES.DOCUMENT_OCR_PROCESSED,
          "Document OCR processed via Google Generative AI",
          null,
          {
            assessment_id: assessmentId,
            prompt_token_count: promptTokenCount,
            candidates_token_count: candidatesTokenCount,
            total_token_count: totalTokenCount,
          }
        );
      } catch (logError) {
        console.error("[assessDocumentQualityAction] Non-blocking OCR event logging error:", logError);
      }
    }
  } catch (ocrError) {
    console.error("[assessDocumentQualityAction] OCR error during quality assessment:", ocrError);
  }

  const isPoorQualityOcr = isPoorQualityOcrText(ocrText);
  const storedOcrText = isPoorQualityOcr ? "" : ocrText;
  const detectedTests = isPoorQualityOcr ? [] : detectRequestedTests(storedOcrText);

  const { error: pendingError } = await supabase
    .from("pending_document_ocr")
    .insert({
      id: assessmentId,
      user_id: user.id,
      patient_id: patient.id,
      file_name: file.name,
      file_type: file.type,
      file_path: pendingFilePath,
      ocr_text: storedOcrText,
      prompt_token_count: promptTokenCount,
      candidates_token_count: candidatesTokenCount,
      total_token_count: totalTokenCount,
    });

  if (pendingError) {
    console.error("[assessDocumentQualityAction] Pending OCR insert error:", pendingError);
    await supabase.storage.from(DOCUMENT_BUCKET).remove([pendingFilePath]);
    return { success: false, error: "Failed to save document assessment. Please try again." };
  }

  return {
    success: true,
    assessmentId,
    isOcrTextEmpty: isPoorQualityOcr,
    detectedTests,
  };
}

type ConfirmSubmitResult = { success: boolean; error?: string };

export async function confirmSubmitDocumentAction(assessmentId: string, selectedTestIds?: string[]) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  const consentError = await privacyConsentError(supabase, user.id);
  if (consentError) {
    return { success: false, error: consentError };
  }

  if (!validateAssessmentId(assessmentId)) {
    return { success: false, error: "Invalid document assessment reference." };
  }

  const { patient, error: patientError } = await getPatientForCurrentUser(supabase, user.id);
  if (patientError || !patient) {
    return { success: false, error: patientError };
  }

  const submitted = (): ConfirmSubmitResult => {
    revalidatePath("/patient/submissions");
    revalidatePath("/patient/dashboard");
    return { success: true };
  };

  // The pending row is gone once an assessment has been submitted. A repeated
  // or concurrent confirmation of it gets the original submission back rather
  // than "expired".
  const alreadySubmittedOr = async (failure: string): Promise<ConfirmSubmitResult> => {
    const existing = classifyRead(
      await supabase
        .from("documents")
        .select("id")
        .eq("source_assessment_id", assessmentId)
        .eq("uploader_id", user.id)
        .single<{ id: string }>()
    );
    if (existing.kind === "ok") return submitted();
    if (existing.kind === "failed") {
      console.error("[confirmSubmitDocumentAction] Submitted document lookup error:", existing.error);
      return { success: false, error: "Failed to check the document submission. Please try again." };
    }
    return { success: false, error: failure };
  };

  const pendingRead = classifyRead(
    await supabase
      .from("pending_document_ocr")
      .select("id, patient_id, file_name, file_type, file_path, ocr_text")
      .eq("id", assessmentId)
      .eq("user_id", user.id)
      .single<PendingDocumentOcrRow>()
  );

  if (pendingRead.kind === "failed") {
    console.error("[confirmSubmitDocumentAction] Pending OCR read error:", pendingRead.error);
    return { success: false, error: "Failed to load the document assessment. Please try again." };
  }

  const pendingRow = pendingRead.kind === "ok" ? pendingRead.data : null;
  if (!pendingRow) {
    return alreadySubmittedOr(ASSESSMENT_EXPIRED_ERROR);
  }

  if (pendingRow.patient_id !== patient.id) {
    return { success: false, error: "Document assessment does not match your patient profile." };
  }

  const { data: pendingFile, error: downloadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .download(pendingRow.file_path);

  if (downloadError || !pendingFile) {
    console.error("[confirmSubmitDocumentAction] Pending file download error:", downloadError);
    // A concurrent confirmation may have just submitted it and removed the file.
    return alreadySubmittedOr("Failed to retrieve assessed file. Please upload it again.");
  }

  // One final path per assessment, written with the service role and upsert.
  // The patient can write objects under their own folder, so anything already
  // at this path is replaced by the assessed pending file rather than accepted
  // as the submission; concurrent confirmations write the same bytes.
  const fileExtension = getFileExtension(pendingRow.file_name, pendingRow.file_type);
  const finalFilePath = finalDocumentPath(user.id, assessmentId, fileExtension);
  const finalFileBuffer = Buffer.from(await pendingFile.arrayBuffer());

  const { error: uploadError } = await createAdminClient().storage
    .from(DOCUMENT_BUCKET)
    .upload(finalFilePath, finalFileBuffer, {
      contentType: pendingRow.file_type,
      upsert: true,
    });

  if (uploadError) {
    console.error("[confirmSubmitDocumentAction] Final storage upload error:", uploadError);
    return { success: false, error: `Failed to upload file to storage: ${uploadError.message}` };
  }

  const detectedTests = detectRequestedTests(pendingRow.ocr_text);
  const selectedTests = selectDetectedTests(detectedTests, selectedTestIds);
  const extractedMetadata = detectedTests.length > 0
    ? {
        detected_tests: detectedTests,
        selected_tests: selectedTests,
        test_detection_source: "ocr_text_catalog_match",
        test_detection_version: 1,
      }
    : null;

  // Service role, not the patient's session: patients hold no INSERT policy on
  // documents (migration_23), so patient_id, uploader_id and status can only be
  // the ones derived above from the authenticated user. The function consumes
  // the pending row and inserts the document in one transaction (migration_34),
  // so only one confirmation of an assessment creates a document; the others
  // get that document's id back with created = false.
  const { data: submission, error: submitError } = await createAdminClient()
    .rpc("submit_assessed_document", {
      p_assessment_id: assessmentId,
      p_user_id: user.id,
      p_patient_id: patient.id,
      p_file_path: finalFilePath,
      p_extracted_metadata: extractedMetadata,
    })
    .single<{ document_id: string; created: boolean }>();

  if (submitError?.code === "P0002") {
    // Neither a pending row nor a document: the assessment was discarded while
    // this request ran. Nothing can reference the final file any more.
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([finalFilePath]);
    if (removeError) {
      console.error("[confirmSubmitDocumentAction] Failed to delete unused final file:", removeError);
    }
    return { success: false, error: ASSESSMENT_EXPIRED_ERROR };
  }

  if (submitError || !submission) {
    // The final file is kept: the transaction rolled back, so the pending row
    // is still there and a retry reuses the same path. If the call did commit
    // and only the response was lost, the new document references this file.
    console.error("[confirmSubmitDocumentAction] Document submission error:", submitError);
    return { success: false, error: "Failed to save document. Please try again." };
  }

  if (!submission.created) {
    return submitted();
  }

  const { error: removePendingFileError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .remove([pendingRow.file_path]);

  if (removePendingFileError) {
    console.error("[confirmSubmitDocumentAction] Failed to delete pending file:", removePendingFileError);
  }

  await logEvent(
    supabase,
    user.id,
    SYSTEM_EVENT_TYPES.DOCUMENT_SUBMITTED,
    `Patient submitted document: ${pendingRow.file_name}`,
    null,
    { document_id: submission.document_id, file_name: pendingRow.file_name, assessment_id: assessmentId }
  );

  return submitted();
}

export async function discardAssessedDocumentAction(assessmentId: string) {
  // Standing Rule 1: supabase.auth.getUser() first line
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized: Please log in." };
  }

  if (!validateAssessmentId(assessmentId)) {
    return { success: false, error: "Invalid document assessment reference." };
  }

  const { data: pendingRow } = await supabase
    .from("pending_document_ocr")
    .select("file_path")
    .eq("id", assessmentId)
    .eq("user_id", user.id)
    .maybeSingle<{ file_path: string }>();

  const { error: deleteError } = await supabase
    .from("pending_document_ocr")
    .delete()
    .eq("id", assessmentId)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("[discardAssessedDocumentAction] Failed to delete pending OCR row:", deleteError);
    return { success: false, error: "Failed to clear pending document assessment." };
  }

  if (pendingRow?.file_path) {
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([pendingRow.file_path]);
    if (removeError) {
      console.error("[discardAssessedDocumentAction] Failed to remove pending file:", removeError);
    }
  }

  return { success: true };
}
