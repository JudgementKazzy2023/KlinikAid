// The Content-Security-Policy is NOT set here: it carries a per-request nonce
// (issue #154) that this static headers() block cannot know. src/middleware.ts
// sets it on every HTML response from the shared template in csp.mjs; the
// middleware matcher covers every path except static assets, which serve no
// HTML and need no policy. These headers are the nonce-independent remainder.
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
