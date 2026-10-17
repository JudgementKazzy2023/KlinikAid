"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getDefaultLandingPath } from "@/lib/auth/helpers";
import { MUST_CHANGE_PASSWORD, mustChangePassword } from "@/lib/auth/temporary-password";
import { PASSWORD_REQUIREMENT_TEXT, validatePassword } from "@/lib/validation";

export interface SetPasswordResult {
  error?: string;
  success?: boolean;
  redirectUrl?: string;
}

/**
 * Replaces the temporary password a receptionist set, and clears the flag that
 * holds the session at /set-password.
 *
 * The password and the flag change in one admin call, so neither can be left
 * half done. Changing the password through the admin API also revokes every
 * session the account has, including any opened with the temporary password,
 * so the patient is signed back in with the new one afterwards.
 */
export async function setPasswordAction(
  prevState: SetPasswordResult | null,
  formData: FormData
): Promise<SetPasswordResult> {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: "Your session has expired. Please sign in again." };
  }

  if (!mustChangePassword(user)) {
    return { error: "This account does not need a new password." };
  }

  if (!password || !validatePassword(password)) {
    return { error: PASSWORD_REQUIREMENT_TEXT };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // The admin API does not refuse an unchanged password, so check here that the
  // new one is not the temporary one. A throwaway client keeps this probe away
  // from the patient's cookies.
  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: probeError } = await probe.auth.signInWithPassword({ email: user.email, password });
  if (!probeError) {
    await probe.auth.signOut({ scope: "local" });
    return { error: "Choose a password different from the temporary one you were given." };
  }
  if (probeError.code !== "invalid_credentials") {
    return { error: "Unable to check the new password right now. Please try again." };
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password,
    // null removes the key; app_metadata is merged, not replaced.
    app_metadata: { [MUST_CHANGE_PASSWORD]: null },
  });

  if (updateError) {
    return { error: updateError.message || "Failed to set the new password." };
  }

  const ipAddress = (await headers()).get("x-forwarded-for")?.split(",")[0] || null;
  await logEvent(
    admin,
    user.id,
    SYSTEM_EVENT_TYPES.PASSWORD_CHANGED,
    "User replaced the temporary password set at reception",
    ipAddress,
    { user_id: user.id }
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (signInError) {
    return { success: true, redirectUrl: "/login?reset=success" };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const redirectUrl = profile ? await getDefaultLandingPath(user.id, profile) : "/login";

  return { success: true, redirectUrl };
}
