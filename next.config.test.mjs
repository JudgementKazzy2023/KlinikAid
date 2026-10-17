import assert from "node:assert/strict";
import test from "node:test";
import config from "./next.config.mjs";

test("CSP accepts HTTP(S) Supabase origins and rejects other schemes", async () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    for (const [url, websocket] of [
      ["https://project.supabase.co", "wss://project.supabase.co"],
      ["http://127.0.0.1:54321", "ws://127.0.0.1:54321"],
    ]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      const rules = await config.headers();
      const csp = rules[0].headers.find((header) => header.key === "Content-Security-Policy");
      assert.ok(csp.value.includes(url));
      assert.ok(csp.value.includes(websocket));
    }
    for (const url of ["ftp://example.com", "file:///tmp/db", "javascript:alert(1)"]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      await assert.rejects(config.headers(), /must use http: or https:/);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  }
});
