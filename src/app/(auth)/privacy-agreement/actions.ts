"use server";

import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export interface AcceptPrivacyResult {
  error?: string;
  success?: boolean;
}

export async function acceptPrivacyAction(): Promise<AcceptPrivacyResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated. Please log in first." };
  }

  // Update profile
  const { error } = await supabase
    .from("profiles")
    .update({ accepted_privacy_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  // Log audit trail event
  await logEvent(
    supabase,
    user.id,
    SYSTEM_EVENT_TYPES.PRIVACY_ACCEPTED,
    `Patient accepted the Republic Act 10173 Data Privacy Agreement`
  );

  return { success: true };
}

/**
 * Declining signs the patient out, like logoutAction, but lands on a login page
 * that says why, instead of a bare /login that reads as a crash.
 */
export async function declinePrivacyAction(): Promise<never> {
  const supabase = await createClient();
  const ipAddress = (await headers()).get("x-forwarded-for")?.split(",")[0] || null;
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.LOGOUT,
      "Patient declined the Republic Act 10173 Data Privacy Agreement and was signed out",
      ipAddress
    );
  }

  await supabase.auth.signOut();
  redirect("/login?notice=privacy_declined");
}
