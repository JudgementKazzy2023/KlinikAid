import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural contracts for the auth pages (issues #20 and #152).
 *
 * Two of the surfaces this guards are unreachable to the anonymous browser
 * suite: `/reset-password` only renders its fields behind a single-use
 * recovery link, and `/privacy-agreement` renders only for a signed-in patient
 * who has not accepted yet. Reading the route sources is the coverage those
 * states have in CI; `e2e/auth-leading-icons.spec.ts` measures the reachable
 * pages in a real browser.
 *
 * The rule that used to live here — an absolutely positioned icon must carry
 * `pointer-events-none`, or it swallows the tap meant for the field under it
 * — moved to `src/lib/icon-overlays.test.ts` with issue #181, which states it
 * for every file in `src/` instead of for the auth routes only. What is left
 * here is the contract that is specific to the auth pages: the page has one
 * scroll container, not two.
 */

const AUTH_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every .tsx file under the auth routes, recursively. */
function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

/** One row per source line, so a failure can name the file and line it saw. */
function sourceLines(): Array<{ file: string; line: number; text: string }> {
  return tsxFiles(AUTH_DIR).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((text, index) => ({ file: file.slice(AUTH_DIR.length), line: index + 1, text })),
  );
}

describe("auth page decorations", () => {
  it("gives the page one scroll container instead of a wrapper that also scrolls", () => {
    // min-h-screen wrappers used to declare overflow-y-auto, so a decorative
    // circle outside the box opened a second, independent scrollbar (#20 item
    // 2 on /register, #152 on /privacy-agreement). The document is the page's
    // only scroll container; the agreement text box keeps its own overflow
    // because scrolling it is how the consent gate opens.
    const wrappers = sourceLines().filter(
      ({ text }) => text.includes("min-h-screen") && text.includes("flex items-center"),
    );
    expect(wrappers.length, "expected an auth page wrapper to inspect").toBeGreaterThan(0);

    const scrolling = wrappers.filter(({ text }) => /overflow-y-(auto|scroll)|[^-]overflow-auto/.test(text));
    expect(
      scrolling.map(({ file, line, text }) => `${file}:${line} ${text.trim()}`),
      "auth page wrappers must clip their decoration, not scroll it",
    ).toEqual([]);

    const agreementBox = sourceLines().filter(({ text }) => text.includes("h-80 overflow-y-auto"));
    expect(
      agreementBox.map(({ file }) => file),
      "the agreement text box must keep its own scroller, or the scroll-to-accept gate can never open",
    ).toEqual(["privacy-agreement/PrivacyAgreementClient.tsx"]);
  });
});
