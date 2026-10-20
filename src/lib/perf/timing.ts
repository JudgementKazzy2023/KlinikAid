import { headers } from "next/headers";

/**
 * Opt-in server timing for the dashboard navigation work (issue #165).
 *
 * Enabled only when `KLINIKAID_TIMING=1` is set; never on by default. When it
 * is on, every instrumented await prints one line to the server log:
 *
 *   [KTIMING] <request-id> <name> <milliseconds>
 *
 * The request id is the per-request nonce the middleware already mints for
 * the CSP (issue #154), so a log line can be tied back to the browser request
 * that caused it: the nonce is also in the response's `Content-Security-Policy`
 * header, which the client can read.
 *
 * The instrumentation is a measurement aid, not a feature: it must not change
 * what a request does, and it must cost nothing when it is off.
 */
export const TIMING_ENABLED = process.env.KLINIKAID_TIMING === "1";

/**
 * Identifier for the request currently being rendered. Falls back to a
 * constant outside a request scope (for example in a background job).
 */
export async function timingRequestId(): Promise<string> {
  try {
    const requestHeaders = await headers();
    return requestHeaders.get("x-nonce") ?? "no-request";
  } catch {
    return "no-request";
  }
}

/**
 * Times one await and reports it. The wrapped function is called unchanged
 * whether or not timing is enabled, so the two paths cannot drift apart.
 */
export async function timed<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
  if (!TIMING_ENABLED) {
    return fn();
  }
  const id = await timingRequestId();
  const started = performance.now();
  try {
    return await fn();
  } finally {
    console.log(
      `[KTIMING] ${new Date().toISOString()} ${id} ${name} ${(performance.now() - started).toFixed(1)}`
    );
  }
}
