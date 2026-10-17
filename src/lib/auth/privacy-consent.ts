import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRead, type ReadOutcome } from "@/lib/read-outcome";

/**
 * The Data Privacy Agreement (RA 10173) gate, for route handlers and server
 * actions.
 *
 * The dashboard layout redirects an unconsented patient to /privacy-agreement,
 * but a layout only guards page renders. Route handlers and server actions are
 * reachable directly from the same session, so every one that processes patient
 * data has to repeat the check beside its own authorisation, or the agreement
 * authorises nothing.
 *
 * Only patients are gated, matching the layout: staff never see the agreement.
 *
 * A profile read that fails (or finds no profile) refuses rather than allows.
 * "Could not confirm consent" is not consent.
 */
export type PrivacyConsent =
  | { readonly kind: "ok" }
  | { readonly kind: "not_accepted" }
  | { readonly kind: "failed"; readonly error: unknown };

type ConsentProfile = { role: string | null; accepted_privacy_at: string | null };

export const PRIVACY_CONSENT_REQUIRED_MESSAGE =
  "Please accept the Data Privacy Agreement before using this feature.";

export const PRIVACY_CONSENT_CHECK_FAILED_MESSAGE =
  "We could not confirm your privacy agreement status. Please try again.";

export function evaluatePrivacyConsent(read: ReadOutcome<ConsentProfile | null>): PrivacyConsent {
  if (read.kind === "failed") return { kind: "failed", error: read.error };
  if (read.kind === "absent" || !read.data) {
    return { kind: "failed", error: new Error("No profile found for the current user") };
  }
  if (read.data.role === "patient" && !read.data.accepted_privacy_at) {
    return { kind: "not_accepted" };
  }
  return { kind: "ok" };
}

export async function checkPrivacyConsent(
  supabase: Pick<SupabaseClient, "from">,
  userId: string
): Promise<PrivacyConsent> {
  const read = classifyRead(
    await supabase
      .from("profiles")
      .select("role, accepted_privacy_at")
      .eq("id", userId)
      .single<ConsentProfile>()
  );
  return evaluatePrivacyConsent(read);
}

/**
 * For server actions returning `{ success, error }`: the message to refuse
 * with, or `null` when the caller may proceed.
 */
export async function privacyConsentError(
  supabase: Pick<SupabaseClient, "from">,
  userId: string
): Promise<string | null> {
  const consent = await checkPrivacyConsent(supabase, userId);
  if (consent.kind === "ok") return null;
  if (consent.kind === "failed") {
    console.error("Privacy consent check failed:", consent.error);
    return PRIVACY_CONSENT_CHECK_FAILED_MESSAGE;
  }
  return PRIVACY_CONSENT_REQUIRED_MESSAGE;
}
