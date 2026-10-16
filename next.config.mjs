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
  return { http: url.origin, ws: `${url.protocol === "http:" ? "ws" : "wss"}://${url.host}` };
}

function contentSecurityPolicy() {
  const supabase = supabaseOrigin();
  // React Refresh evaluates modules with eval() in development only.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${devEval}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabase.http}`,
    `connect-src 'self' ${supabase.http} ${supabase.ws}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

// Built inside headers() rather than at module load so that commands which
// read this config without serving pages (next lint) do not need the env var.
const securityHeaders = () => [
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy(),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
