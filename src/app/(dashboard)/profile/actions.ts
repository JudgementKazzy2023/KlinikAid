"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { privacyConsentError } from "@/lib/auth/privacy-consent";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { PASSWORD_REQUIREMENT_TEXT, validatePassword, validateContactNumber, CONTACT_REQUIREMENT_TEXT, validateAddress } from "@/lib/validation";
import { headers } from "next/headers";

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
  warning?: string;
}

type CurrentPasswordCheck = "verified" | "incorrect" | "unavailable";

/**
 * Checks the current password by signing in on a throwaway, in-memory client.
 * The caller's cookie session is never touched, so an aal2 (MFA) session is not
 * downgraded to the aal1 session a password sign-in produces. The probe session
 * is revoked straight away.
 */
async function verifyCurrentPassword(email: string, password: string): Promise<CurrentPasswordCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "unavailable";

  const probe = createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error) {
    // Only a credentials rejection means "wrong password". A rate limit or an
    // unreachable auth server is not proof of anything, so it is reported apart.
    return error.code === "invalid_credentials" ? "incorrect" : "unavailable";
  }

  if (data.session) {
    await probe.auth.signOut({ scope: "local" });
  }
  return "verified";
}

export async function changePasswordAction(
  prevState: ChangePasswordResult | null,
  formData: FormData
): Promise<ChangePasswordResult> {
  const supabase = await createClient();

  // 1. Get active session user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized. Please log in again." };
  }

  const currentPassword = formData.get("currentPassword") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword) {
    return { success: false, error: "Enter your current password." };
  }

  if (!password || !validatePassword(password)) {
    return { success: false, error: PASSWORD_REQUIREMENT_TEXT };
  }

  if (password !== confirmPassword) {
    return { success: false, error: "Passwords do not match." };
  }

  if (!user.email) {
    return { success: false, error: "This account has no email address to verify the password against." };
  }

  try {
    // 2. Re-authenticate: a live session alone must not be enough to take the account over
    const check = await verifyCurrentPassword(user.email, currentPassword);
    if (check === "incorrect") {
      return { success: false, error: "Current password is incorrect." };
    }
    if (check === "unavailable") {
      return { success: false, error: "Could not verify your current password. Please try again in a moment." };
    }

    // 3. Update user password
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // 4. Revoke every other session (other devices, and the probe session above)
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });

    // 5. Log the audit event
    const reqHeaders = await headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.PASSWORD_CHANGED,
      "User changed their password via profile settings",
      ipAddress,
      { user_id: user.id, other_sessions_revoked: !signOutError }
    );

    if (signOutError) {
      return {
        success: true,
        warning: "Password changed, but other sessions could not be signed out. Sign out on your other devices manually.",
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to change password.",
    };
  }
}

export interface UpdatePatientDetailsResult {
  success: boolean;
  error?: string;
}

export async function updatePatientDetailsAction(
  prevState: UpdatePatientDetailsResult | null,
  formData: FormData
): Promise<UpdatePatientDetailsResult> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized. Please log in again." };
  }

  const consentError = await privacyConsentError(supabase, user.id);
  if (consentError) {
    return { success: false, error: consentError };
  }

  const contactNumber = ((formData.get("contactNumber") as string) || "").trim();
  const address = ((formData.get("address") as string) || "").trim();

  if (!contactNumber) {
    return { success: false, error: "Contact number is required." };
  }

  const contactCheck = validateContactNumber(contactNumber);
  if (!contactCheck.valid) {
    return { success: false, error: contactCheck.error ?? CONTACT_REQUIREMENT_TEXT };
  }

  const addressCheck = validateAddress(address);
  if (!addressCheck.valid) {
    return { success: false, error: addressCheck.error ?? "Address is required." };
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { success: false, error: "Unable to verify account profile." };
    }

    if (profile.role !== "patient") {
      return { success: false, error: "Only patient accounts can update patient details here." };
    }

    const { error: updateError } = await supabase
      .from("patients")
      .update({
        contact_number: contactNumber,
        address,
      })
      .eq("profile_id", user.id);

    if (updateError) {
      return { success: false, error: "Unable to update patient details." };
    }

    const reqHeaders = await headers();
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.PROFILE_UPDATED,
      "Patient updated contact details via profile settings",
      ipAddress,
      { user_id: user.id, changed_fields: ["contact_number", "address"] }
    );

    return { success: true };
  } catch {
    return { success: false, error: "Failed to update patient details." };
  }
}
