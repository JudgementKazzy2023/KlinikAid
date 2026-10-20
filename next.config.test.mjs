import assert from "node:assert/strict";
import test from "node:test";
import config from "./next.config.mjs";
import { contentSecurityPolicy } from "./csp.mjs";

const nonce = "test-nonce-8nGvVd3Y";

function scriptSrcOf(csp) {
  const directive = csp
    .split("; ")
    .find((entry) => entry.startsWith("script-src "));
  assert.ok(directive, `script-src missing from CSP: ${csp}`);
  return directive;
}

test("CSP accepts HTTP(S) Supabase origins and rejects other schemes", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    for (const [url, websocket] of [
      ["https://project.supabase.co", "wss://project.supabase.co"],
      ["http://127.0.0.1:54321", "ws://127.0.0.1:54321"],
    ]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      const csp = contentSecurityPolicy(nonce);
      assert.ok(csp.includes(url));
      assert.ok(csp.includes(websocket));
    }
    for (const url of ["ftp://example.com", "file:///tmp/db", "javascript:alert(1)"]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      assert.throws(() => contentSecurityPolicy(nonce), /must use http: or https:/);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});

test("CSP script-src uses the per-request nonce and strict-dynamic, never unsafe-inline", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    const csp = contentSecurityPolicy(nonce);
    const scriptSrc = scriptSrcOf(csp);
    assert.ok(scriptSrc.includes(`'nonce-${nonce}'`), `nonce missing: ${scriptSrc}`);
    assert.ok(scriptSrc.includes("'strict-dynamic'"), `strict-dynamic missing: ${scriptSrc}`);
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), `unsafe-inline present: ${scriptSrc}`);
    // unsafe-eval is for React Refresh and only ever in development.
    assert.ok(!scriptSrc.includes("'unsafe-eval'"), `unsafe-eval outside development: ${scriptSrc}`);
    process.env.NODE_ENV = "development";
    assert.ok(scriptSrcOf(contentSecurityPolicy(nonce)).includes("'unsafe-eval'"));
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("CSP keeps every directive it shipped before the nonce change", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    const csp = contentSecurityPolicy(nonce);
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://project.supabase.co",
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ]) {
      assert.ok(csp.includes(directive), `${directive} missing from CSP: ${csp}`);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});

test("next.config no longer ships a static CSP that could shadow the middleware's", async () => {
  // The nonce is per request, so the header can only come from
  // src/middleware.ts (issue #154). A static CSP here would either lack the
  // nonce (breaking every page) or race with the middleware's.
  const rules = await config.headers();
  const cspHeaders = rules
    .flatMap((rule) => rule.headers)
    .filter((header) => header.key.toLowerCase() === "content-security-policy");
  assert.equal(cspHeaders.length, 0);
  // The remaining security headers are unchanged.
  const keys = rules[0].headers.map((header) => header.key);
  assert.deepEqual(keys, [
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]);
});
