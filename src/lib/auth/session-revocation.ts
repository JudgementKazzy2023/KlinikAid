import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ends a deactivated staff member's Supabase Auth sessions and keeps new ones
 * from being issued until they are reactivated.
 *
 * `is_active = false` already makes every guard (dashboard layout,
 * `requireActiveSession`, RLS) refuse the account, but a refresh token is an
 * Auth credential, not an app one: left alone it keeps minting access tokens
 * for as long as the account is inactive, and starts working again the moment
 * the profile is reactivated. Ending it has to happen in Auth.
 *
 * Auth has no admin endpoint that ends a user's sessions by user id:
 * `auth.admin.signOut()` takes the user's own JWT. So `revokeAllSessions`
 * issues a one-time magic-link token (no email is sent), exchanges it
 * server-side for a session, and signs that session out with scope `global`,
 * which deletes every session and refresh token the user has. The temporary
 * session never leaves this function.
 *
 * Banning is not a substitute. A ban refuses refresh and password sign-in while it lasts,
 * but lifting it leaves the old refresh tokens valid again.
 */

/** Effectively indefinite; lifted explicitly on reactivation. */
const DEACTIVATION_BAN_DURATION = "876000h";

export type AuthStepOutcome = { ok: true } | { ok: false; error: string };

function failed(error: unknown): AuthStepOutcome {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export async function revokeAllSessions(
  adminClient: SupabaseClient,
  userId: string
): Promise<AuthStepOutcome> {
  try {
    const { data: lookup, error: lookupError } = await adminClient.auth.admin.getUserById(userId);
    if (lookupError) return failed(lookupError);
    const email = lookup.user?.email;
    if (!email) return { ok: false, error: "Auth user has no email address" };

    const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) return failed(linkError);

    // A dedicated client, so the temporary session cannot leak into the
    // caller's client and be used as the Authorization of later queries.
    const { data: verified, error: verifyError } = await createAdminClient().auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError) return failed(verifyError);
    if (!verified.session) return { ok: false, error: "Auth returned no session to sign out" };

    const { error: signOutError } = await adminClient.auth.admin.signOut(
      verified.session.access_token,
      "global"
    );
    if (signOutError) return failed(signOutError);

    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function banAuthUser(adminClient: SupabaseClient, userId: string): Promise<AuthStepOutcome> {
  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: DEACTIVATION_BAN_DURATION,
    });
    return error ? failed(error) : { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function liftAuthBan(adminClient: SupabaseClient, userId: string): Promise<AuthStepOutcome> {
  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: "none" });
    return error ? failed(error) : { ok: true };
  } catch (error) {
    return failed(error);
  }
}
