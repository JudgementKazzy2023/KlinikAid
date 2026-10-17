import type { User } from "@supabase/supabase-js";

/**
 * Accounts a receptionist creates start with a password the receptionist has
 * seen. `app_metadata.must_change_password` marks them until the patient
 * replaces it. It lives in app_metadata because only the service role can
 * write that, so the patient cannot clear the flag without a new password.
 */
export const MUST_CHANGE_PASSWORD = "must_change_password";

export const SET_PASSWORD_PATH = "/set-password";

export function mustChangePassword(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.[MUST_CHANGE_PASSWORD] === true;
}

/**
 * Paths a session that still holds a temporary password may reach. Everything
 * else, pages and API routes alike, is turned back to the set-password step.
 * /login stays open so its server action works for anyone signing in again.
 */
const ALLOWED_PREFIXES = [SET_PASSWORD_PATH, "/login", "/logout", "/forgot-password", "/reset-password"];

export function isAllowedWithTemporaryPassword(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
