import { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether the audit row was actually written.
 *
 * `logEvent` used to return `void`, so a rejected insert was visible only as a
 * `console.error` and no caller could tell an audit trail apart from a hole in
 * one. Callers are not required to act on this -- an audit failure must not
 * abort the action being audited -- but the claim "this was logged" is now one
 * the code can check rather than assume.
 */
export type LogWriteOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * Audit trail logger utility.
 * Logs mutation events and system actions securely.
 * Catches all errors internally to prevent breaking the parent transaction/execution.
 *
 * The row is always written with the service-role client, never with the
 * caller's. The `system_logs` INSERT policy requires `auth.uid()`, and the
 * events that matter most -- a wrong password, a wrong TOTP code, a deactivated
 * account -- are recorded precisely when there is no session (or right after
 * `signOut()`). Written with the caller's client, every one of those rows was
 * rejected by RLS and dropped (#41). Writing with the service role also means
 * no browser-held key needs INSERT on the audit table at all, so attribution
 * cannot be forged from the client.
 *
 * @param _callerClient Unused. Kept so the ~40 existing call sites compile
 *   unchanged; the write never goes through the caller's session.
 * @param userId ID of the profile initiating the action, or null when there is none
 * @param eventType Classification of the audit event (e.g. USER_LOGIN, DOCUMENT_APPROVED)
 * @param description Detailed text description of what occurred
 * @param ipAddress Optional IP address of the client request
 * @param metadata Optional JSON key-value bag for extra context
 */
export async function logEvent(
  _callerClient: SupabaseClient,
  userId: string | null,
  eventType: string,
  description: string,
  ipAddress?: string | null,
  metadata?: Record<string, unknown> | null
): Promise<LogWriteOutcome> {
  try {
    const { error } = await createAdminClient().from("system_logs").insert({
      user_id: userId,
      event_type: eventType,
      description: description,
      ip_address: ipAddress || null,
      metadata: metadata || null,
    });

    if (error) {
      console.error("System Logger: failed to write log record to DB:", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    console.error("System Logger: unexpected exception during logging:", err);
    return { ok: false, error: err };
  }
}
