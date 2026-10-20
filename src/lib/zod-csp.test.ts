import { describe, expect, test } from "vitest";
import { z } from "zod";
import "./zod-csp";

// zod v4's JIT fast path probes `new Function("")` once per page load; under
// the nonce CSP (issue #154) that probe fires a securitypolicyviolation event
// even though zod swallows the throw. zod-csp must disable the JIT, and
// parsing must keep working through the interpreted path.
describe("zod-csp", () => {
  test("disables zod's JIT config-wide", () => {
    expect(z.core.globalConfig?.jitless).toBe(true);
  });

  test("object schemas still parse and reject through the interpreted path", () => {
    const schema = z.object({ n: z.number() });
    expect(schema.parse({ n: 1 })).toEqual({ n: 1 });
    expect(() => schema.parse({ n: "not a number" })).toThrow();
  });
});
