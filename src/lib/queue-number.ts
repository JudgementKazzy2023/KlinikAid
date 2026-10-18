/**
 * Reading what `public.triage_patient()` (migration 33) hands back.
 *
 * The function allocates the queue number and inserts the entry in one
 * transaction, so the number is decided in the database, not in the route. It
 * writes the number into `triage_notes.queue_number`, which is where every reader
 * of the queue already looks, and the route reads it back from there so that its
 * response and audit log show exactly what the queue boards show.
 */

/**
 * SQLSTATE `triage_patient()` raises when the patient already has an open
 * (waiting or in_progress) entry. PostgREST answers `PT409` with HTTP 409 and
 * keeps the code in the error body. The function puts the open entry's
 * department in DETAIL, which reaches the client as `details`.
 */
export const OPEN_QUEUE_ENTRY_SQLSTATE = "PT409";

/**
 * The department of the patient's existing open entry, if `error` is the
 * open-entry refusal; `null` for any other error, or none.
 */
export function openQueueEntryDepartment(
  error: { code?: string; details?: string | null } | null | undefined
): string | null {
  if (error?.code !== OPEN_QUEUE_ENTRY_SQLSTATE) return null;
  return error.details ?? "";
}

/** `triage_notes.queue_number`, or `null` if the notes hold no such string. */
export function queueNumberFromTriageNotes(triageNotes: unknown): string | null {
  if (typeof triageNotes !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(triageNotes);
    if (parsed && typeof parsed === "object" && "queue_number" in parsed) {
      const value = (parsed as { queue_number: unknown }).queue_number;
      return typeof value === "string" ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}
