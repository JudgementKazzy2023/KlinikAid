import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { fileURLToPath } from "node:url";

/**
 * Regression tests for #149: `focus-visible:ring-3` never painted a ring.
 *
 * The shadcn "base-nova" ui kit (button, input, select, textarea, switch)
 * declares `focus-visible:ring-3` / `aria-invalid:ring-3`, which are Tailwind
 * v4 utilities. This repo runs Tailwind v3, whose ringWidth theme is
 * {0, 1, 2, 4, 8, DEFAULT: 3px}, so `.ring-3` matched no utility and compiled
 * to nothing: `--tw-ring-shadow` stayed at its `0 0 #0000` default, box-shadow
 * was never set, and keyboard focus showed only a 1px border recolor.
 *
 * These tests compile a snippet through the repo's real Tailwind config and
 * assert the utility exists and emits the full ring box-shadow machinery. They
 * fail if the `ringWidth: { 3: "3px" }` entry in tailwind.config.ts is removed.
 */

const configPath = fileURLToPath(
  new URL("../../tailwind.config.ts", import.meta.url)
);

async function compileUtilities(classes: string): Promise<string> {
  const config = loadConfig(configPath);
  const result = await postcss([
    tailwindcss({
      ...config,
      // Override the content globs: compiling the whole app for one utility
      // assertion would make this test depend on unrelated files.
      content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

/** The declaration block whose selector contains `needle`, or undefined. */
function ruleBlock(css: string, needle: string): string | undefined {
  return css
    .split("}")
    .map((block) => block + "}")
    .find((block) => block.includes(needle));
}

const RING_SHADOW_3PX =
  "--tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color)";
const COMPOSED_BOX_SHADOW =
  "box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000)";

describe("tailwind ring-3 utility (issue #149)", () => {
  it("compiles focus-visible:ring-3 into the 3px ring box-shadow machinery", async () => {
    const css = await compileUtilities("focus-visible:ring-3");
    const block = ruleBlock(css, ".focus-visible\\:ring-3");
    expect(block, "`.ring-3` must exist as a utility in the Tailwind v3 config").toBeDefined();
    expect(block).toContain(RING_SHADOW_3PX);
    expect(block).toContain(COMPOSED_BOX_SHADOW);
  });

  it("compiles aria-invalid:ring-3 (the invalid-state ring used by the ui kit)", async () => {
    const css = await compileUtilities("aria-invalid:ring-3");
    const block = ruleBlock(css, ".aria-invalid\\:ring-3");
    expect(block).toBeDefined();
    expect(block).toContain(RING_SHADOW_3PX);
    expect(block).toContain(COMPOSED_BOX_SHADOW);
  });

  it("keeps the ring colour plumbing that paints the ring from --ring", async () => {
    // The ui kit pairs every `ring-3` with `ring-ring/50`; without this the
    // ring would fall back to Tailwind's default blue instead of the theme
    // token that light/dark mode switch (globals.css :root / .dark).
    const css = await compileUtilities("focus-visible:ring-ring/50");
    const block = ruleBlock(css, ".focus-visible\\:ring-ring\\/50");
    expect(block).toBeDefined();
    expect(block).toContain("--tw-ring-color: hsl(var(--ring) / 0.5)");
  });
});
