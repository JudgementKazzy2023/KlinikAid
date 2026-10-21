// The Content-Security-Policy for every HTML response.
//
// `script-src` carries a per-request nonce plus 'strict-dynamic' instead of
// 'unsafe-inline' (issue #154), following the official Next.js App Router CSP
// guide: src/middleware.ts generates the nonce per request, forwards it to the
// render as the `x-nonce` request header (so Next.js stamps its own inline
// scripts with it), and sets the resulting header on every response. Because
// the nonce is only known per request, the header cannot be emitted from
// next.config.mjs's static headers() any more; this module is the single
// template both sides share so the directive list cannot drift.
//
// The CSP must allow whichever Supabase project this deployment talks to, so
// derive it from the same env var the clients use. Missing or malformed is a
// hard error: a policy pinned to the wrong project would block storage images
// and realtime without anything surfacing in the UI.
function supabaseOrigin() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set; it is needed to build the Content-Security-Policy"
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use http: or https:");
  }
  return { http: url.origin, ws: `${url.protocol === "http:" ? "ws" : "wss"}://${url.host}` };
}

/**
 * Build the Content-Security-Policy header value for one request.
 *
 * @param {string} nonce - Per-request nonce, without the 'nonce-' prefix.
 * @returns {string} The header value.
 */
export function contentSecurityPolicy(nonce) {
  const supabase = supabaseOrigin();
  // React Refresh evaluates modules with eval() in development only.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabase.http}`,
    `connect-src 'self' ${supabase.http} ${supabase.ws}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}
