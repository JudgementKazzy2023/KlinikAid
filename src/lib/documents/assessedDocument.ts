/**
 * Helpers for turning a pending document assessment into a submitted document
 * exactly once (#45).
 *
 * The database decides which request consumes an assessment
 * (`submit_assessed_document`, migration_34). These helpers keep the storage
 * side consistent with that: every request for one assessment writes the same
 * final file, so concurrent or retried confirmations cannot leave several
 * files behind.
 */

/**
 * The one final storage path for an assessment: `<user>/<assessment>.<ext>`.
 * `submit_assessed_document` rejects any other path. The extension is reduced
 * to `[a-z0-9]` so a crafted file name cannot add a path segment.
 */
export function finalDocumentPath(userId: string, assessmentId: string, extension: string): string {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${userId}/${assessmentId}.${safeExtension}`;
}

type StorageErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

/**
 * True when an `upload(..., { upsert: false })` failed only because the object
 * already exists. For a final path that means another request for the same
 * assessment, or an earlier attempt, already uploaded the same pending file.
 *
 * Supabase Storage reports this as statusCode "409" (HTTP status 400 or 409
 * depending on the server version), message "The resource already exists".
 */
export function isStorageDuplicateError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { status, statusCode, message } = error as StorageErrorLike;
  if (statusCode === "409" || statusCode === 409 || status === 409) {
    return true;
  }
  return typeof message === "string" && /already exists/i.test(message);
}
