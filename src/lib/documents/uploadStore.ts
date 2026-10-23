import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UploadError,
  type UploadStore,
} from "@/lib/documents/uploadSubmission";

export function uploadStore(admin: SupabaseClient): UploadStore {
  return {
    async pending(userId, assessmentId) {
      const { data, error } = await admin.from("pending_document_ocr")
        .select("id,user_id,patient_id,file_name,file_type,file_path,ocr_text")
        .eq("id", assessmentId).eq("user_id", userId).maybeSingle();
      if (error) throw new UploadError("SERVER_ERROR");
      return data;
    },
    async file(path) {
      const bucket = admin.storage.from("patient-documents");
      const split = path.lastIndexOf("/");
      const { data: entries, error: listError } = await bucket.list(
        path.slice(0, split),
        { search: path.slice(split + 1), limit: 100 },
      );
      if (listError) throw new UploadError("SERVER_ERROR");
      const object = entries?.find((entry) =>
        entry.name === path.slice(split + 1)
      );
      if (!object?.id || !object.metadata) return null;
      // Refuse an oversized object before pulling it into the function's memory.
      const size = Number(object.metadata.size);
      if (!Number.isFinite(size) || size < 1 || size > 5 * 1024 * 1024) {
        return null;
      }
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return Object.assign(data, {
        objectSnapshot: { id: object.id, metadata: object.metadata },
      });
    },
    async submit(input) {
      const { data, error } = await admin.rpc("submit_patient_upload", {
        p_user_id: input.user_id,
        p_patient_id: input.patient_id,
        p_request_id: input.request_id,
        p_assessment_id: input.assessment_id,
        p_fingerprint: input.fingerprint,
        p_metadata: input.metadata,
        p_pending: input.pending,
        p_object_snapshot: input.object_snapshot,
      });
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return data;
    },
    async lookup(userId, requestId) {
      const { data, error } = await admin.rpc("submit_patient_upload_outcome", {
        p_user_id: userId,
        p_request_id: requestId,
      });
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return data;
    },
  };
}
