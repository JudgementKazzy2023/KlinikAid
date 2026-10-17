import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_ORIGIN } from "@/lib/constants";

export const EMAIL_CONFIRM_PATH = "/confirm-email";

/**
 * Asks Supabase Auth to email a signup confirmation link.
 *
 * Patient accounts are created with `email_confirm: false`, and Auth refuses a
 * password sign-in (`email_not_confirmed`) until the link is opened. That
 * refusal is the gate, independent of the project's "Confirm email" setting.
 *
 * Auth answers the same way for an unknown address and for an already
 * confirmed one (200, nothing sent), so callers can use this on any address
 * without revealing which addresses have accounts.
 */
export function sendEmailConfirmation(client: SupabaseClient, email: string) {
  return client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${SITE_ORIGIN}${EMAIL_CONFIRM_PATH}` },
  });
}
