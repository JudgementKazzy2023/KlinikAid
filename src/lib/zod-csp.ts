import { z } from "zod";

/**
 * Disable zod v4's JIT parsing under a CSP (issue #154).
 *
 * The JIT fast path probes `new Function("")` once per page load to decide
 * whether code generation is allowed. Under a nonce-based CSP the probe is
 * blocked: zod swallows the throw and falls back to its interpreted parser,
 * but the browser still fires a `securitypolicyviolation` event for the
 * attempt — zod itself calls this out in its source. Turning the JIT off
 * keeps client-side validation CSP-clean; the interpreted parser is a little
 * slower, which does not matter for form-sized payloads.
 *
 * The server has no CSP, so this is imported only from client components that
 * parse with zod; a new client-side zod parse site must import it too.
 */
z.config({ jitless: true });
