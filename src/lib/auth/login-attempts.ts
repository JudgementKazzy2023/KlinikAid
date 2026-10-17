import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sign-in attempt limits and single-use TOTP codes (#59).
 *
 * The state lives in Postgres (migration_27) and is reached only through the
 * service-role client: the functions are not executable by anon or
 * authenticated, so a browser cannot reset its own counter.
 *
 * Every function here fails closed. If the limiter cannot be consulted, the
 * caller is told the attempt is not allowed rather than being let through
 * unlimited -- an outage of this table must not quietly turn the limit off.
 */

/** Mirrors the constants in begin_login_attempt(); used only for messages. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export type AttemptGate =
  | { kind: "allowed" }
  | { kind: "locked"; retryAfter: Date }
  | { kind: "failed"; error: unknown };

type BeginRow = { allowed: boolean; retry_after: string | null };

/**
 * Counts one sign-in submission for (email, ip), or refuses it.
 * Call before `signInWithPassword`: the password check itself is what is
 * being rate-limited.
 */
export async function beginLoginAttempt(email: string, ip: string | null): Promise<AttemptGate> {
  try {
    const { data, error } = await createAdminClient()
      .rpc("begin_login_attempt", { p_email: email, p_ip: ip ?? "" })
      .single<BeginRow>();
    if (error || !data) return { kind: "failed", error: error ?? new Error("no row returned") };
    if (data.allowed) return { kind: "allowed" };
    if (!data.retry_after) return { kind: "failed", error: new Error("refused without retry_after") };
    return { kind: "locked", retryAfter: new Date(data.retry_after) };
  } catch (err) {
    return { kind: "failed", error: err };
  }
}

/**
 * Hands back the attempt counted for a submission that proved the password
 * and stopped at the TOTP prompt. Best effort: a failure only costs the user
 * one attempt, so it is logged rather than surfaced.
 */
export async function refundLoginAttempt(email: string, ip: string | null): Promise<void> {
  await callVoid("refund_login_attempt", email, ip);
}

/** Resets the counter for (email, ip) after a completed sign-in. Best effort. */
export async function clearLoginAttempts(email: string, ip: string | null): Promise<void> {
  await callVoid("clear_login_attempts", email, ip);
}

export type TotpClaim = { kind: "claimed" } | { kind: "replayed" } | { kind: "failed"; error: unknown };

/**
 * Records that GoTrue just accepted `code` for `factorId`. `replayed` means
 * the same code already completed a sign-in for this factor within its
 * validity window, and this sign-in must be refused.
 */
export async function claimTotpCode(factorId: string, code: string): Promise<TotpClaim> {
  try {
    const { data, error } = await createAdminClient().rpc("claim_totp_code", {
      p_factor_id: factorId,
      p_code: code,
    });
    if (error || typeof data !== "boolean") {
      return { kind: "failed", error: error ?? new Error("non-boolean result") };
    }
    return data ? { kind: "claimed" } : { kind: "replayed" };
  } catch (err) {
    return { kind: "failed", error: err };
  }
}

/** "Too many sign-in attempts. Try again in 12 minutes." */
export function lockedOutMessage(retryAfter: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((retryAfter.getTime() - now.getTime()) / 60_000));
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function callVoid(fn: string, email: string, ip: string | null): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc(fn, { p_email: email, p_ip: ip ?? "" });
    if (error) console.error(`login-attempts: ${fn} failed:`, error);
  } catch (err) {
    console.error(`login-attempts: ${fn} threw:`, err);
  }
}
