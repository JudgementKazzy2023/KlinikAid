import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";

/**
 * Regression tests for #168: the shadcn "base-nova" ui kit is written for
 * **Tailwind v4**, but this repo runs **Tailwind v3.4**. v4 understands bare
 * `data-<state>:` variants (`data-open:`), `in-data-[…]:` ("this element is
 * inside an element carrying that data attribute") and `has-data-[…]:` ("this
 * element contains one"). v3 only understands the bracketed `data-[…]:` form,
 * so every one of those classes compiled to *nothing*:
 *
 * - the dialog / alert-dialog / sheet open-close transitions never ran
 *   (`data-open:`, `data-closed:`, `data-starting-style:`, `data-ending-style:`),
 * - the switch never changed colour (`data-checked:` / `data-unchecked:`),
 * - the select item, icon padding and button-group rounding fell back to their
 *   defaults (`has-data-[…]:`, `in-data-[…]:`).
 *
 * The fix registers the v3 equivalents of those variants centrally in
 * tailwind.config.ts, so this test compiles the classes the source actually
 * uses with the repo's real config and asserts each one emits a rule.
 */

const require = createRequire(import.meta.url);

/** Tailwind's own candidate extractor — the same one the build uses. */
const { defaultExtractor } = require(
  "tailwindcss/lib/lib/defaultExtractor.js",
) as {
  defaultExtractor: (context: {
    tailwindConfig: unknown;
  }) => (content: string) => string[];
};

/** Tailwind's own class-name escaper, so assertions match the emitted CSS. */
const { default: escapeClassName } = require(
  "tailwindcss/lib/util/escapeClassName.js",
) as { default: (className: string) => string };

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const configPath = fileURLToPath(
  new URL("../../tailwind.config.ts", import.meta.url),
);

/**
 * The Tailwind v4 variant families the ui kit uses and Tailwind v3 does not
 * understand. The bare `data-<state>:` forms are matched generically (see
 * `isV4Variant`), so a state the kit does not use yet is still caught.
 * `data-[…]:` (bracketed) is deliberately *not* matched: v3 supports that form
 * natively.
 */
const V4_VARIANT_NAMES = ["in-data", "has-data", "group-has-data"];

/**
 * Marker that identifies the plugin in tailwind.config.ts, so the "before the
 * fix" config can be rebuilt from the real one. The plugin registers the
 * `data-starting-style` variant, so its source always mentions it.
 */
const DATA_VARIANT_PLUGIN_MARKER = "data-starting-style";

function isDataVariantPlugin(plugin: unknown): boolean {
  if (typeof plugin !== "object" || plugin === null || !("handler" in plugin)) {
    return false;
  }
  const { handler } = plugin as { handler: unknown };
  return (
    typeof handler === "function" &&
    handler.toString().includes(DATA_VARIANT_PLUGIN_MARKER)
  );
}

/** Split a candidate into its variant parts and its utility, on top-level ":". */
function splitCandidate(candidate: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of candidate) {
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    if (character === ":" && depth === 0) {
      variants.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  return { variants, utility: current };
}

/** True when `part` is one of the v4-only variant names (with an optional value). */
function isV4Variant(part: string): boolean {
  // Any bare `data-<state>` variant: v4 turns it into `&[data-<state>]`, v3
  // has no such variant at all. The bracketed `data-[…]` form is native to v3
  // and must not match.
  if (/^data-[a-z][a-z0-9-]*$/.test(part)) return true;
  return V4_VARIANT_NAMES.some(
    (name) =>
      part === name ||
      // `in-data-[slot=button-group]` — the arbitrary value is appended with a
      // dash, `has-data-[…]` style names without one.
      part.startsWith(`${name}-[`) ||
      part.startsWith(`${name}-`) ||
      part.startsWith(`${name}[`) ||
      part.startsWith(`${name}/`),
  );
}

/**
 * Every class in `src/` that uses one of the v4-only variants. The list is
 * derived from the source, so a new use in the ui kit is covered
 * automatically.
 */
function collectV4VariantClasses(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      // Unit tests are excluded: they contain class strings that are not part
      // of the shipped class surface.
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(path.join(repoRoot, "src"));

  const extract = defaultExtractor({
    tailwindConfig: { separator: ":", prefix: "" },
  });
  const classes = new Set<string>();
  for (const file of files) {
    for (const candidate of extract(fs.readFileSync(file, "utf8"))) {
      // A real class starts with a letter; the extractor also yields fragments
      // such as "/switch:data-checked:translate-x-".
      if (!/^[a-zA-Z]/.test(candidate)) continue;
      const { variants, utility } = splitCandidate(candidate);
      if (!utility) continue;
      if (variants.some(isV4Variant)) classes.add(candidate);
    }
  }
  return [...classes].sort();
}

async function compile(
  config: ReturnType<typeof loadConfig>,
  classes: string[],
): Promise<string> {
  const result = await postcss([
    tailwindcss({
      ...config,
      // Override the content globs: compiling the whole app for one utility
      // assertion would make this test depend on unrelated files.
      content: [
        { raw: `<div class="${classes.join(" ")}"></div>`, extension: "html" },
      ],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

/** True when the compiled CSS contains a rule for `className`. */
function hasRule(css: string, className: string): boolean {
  const escaped = escapeClassName(className).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`).test(css);
}

describe("tailwind v4 data-* variants under tailwind v3 (issue #168)", () => {
  it("finds the v4-only variant classes the ui kit uses", () => {
    const classes = collectV4VariantClasses();
    // A sanity floor: the scan must actually find the ui kit's classes, or
    // the compile assertions below would pass vacuously.
    expect(classes).toContain("data-open:animate-in");
    expect(classes).toContain("data-checked:bg-primary");
    expect(classes).toContain("in-data-[slot=button-group]:rounded-lg");
    expect(classes).toContain("has-data-[slot=card-footer]:pb-0");
    expect(classes.length).toBeGreaterThan(20);
  });

  it("compiles every v4-style variant class used in src/ into a CSS rule", async () => {
    const config = loadConfig(configPath);
    const classes = collectV4VariantClasses();
    const css = await compile(config, classes);

    const missing = classes.filter((className) => !hasRule(css, className));
    expect(
      missing,
      "these v4-only variant classes compile to nothing — register the v3 " +
        "equivalent of the variant in tailwind.config.ts",
    ).toEqual([]);
  });

  it("emits the attribute selectors the kit intends", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, [
      "data-open:fade-in-0",
      "data-closed:fade-out-0",
      "data-checked:bg-primary",
      "data-unchecked:bg-input",
      "data-disabled:opacity-50",
      "data-placeholder:text-muted-foreground",
      "data-starting-style:opacity-0",
      "data-ending-style:opacity-0",
      "in-data-[slot=button-group]:rounded-lg",
      "has-data-[slot=card-footer]:pb-0",
      "has-data-[icon=inline-start]:pl-1.5",
      "group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
    ]);

    expect(css).toContain("[data-open]");
    expect(css).toContain("[data-closed]");
    expect(css).toContain("[data-checked]");
    expect(css).toContain("[data-unchecked]");
    expect(css).toContain("[data-disabled]");
    expect(css).toContain("[data-placeholder]");
    expect(css).toContain("[data-starting-style]");
    expect(css).toContain("[data-ending-style]");
    // v4: `:where([data-slot="button-group"]) &`
    expect(css).toContain(':where([data-slot="button-group"])');
    // v4: `&:has([data-slot="card-footer"])`
    expect(css).toContain(':has([data-slot="card-footer"])');
    expect(css).toContain(':has([data-icon="inline-start"])');
    // v4: `:where(.group\/alert-dialog-content):has([data-slot="alert-dialog-media"]) &`
    expect(css).toContain(':has([data-slot="alert-dialog-media"])');
  });

  it("keeps the switch thumb translation, which combines a group and a data variant", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, [
      "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]",
    ]);
    // The thumb is a descendant of the switch root (which carries
    // `data-checked` itself) — Base UI sets the state attribute on both.
    expect(css).toContain('.group\\/switch[data-size="default"]');
    expect(css).toContain("[data-checked]");
  });

  it("lets the dark variant override the plain one (source order)", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, [
      "data-unchecked:bg-input",
      "dark:data-unchecked:bg-input/80",
    ]);
    const plain = css.indexOf(".data-unchecked\\:bg-input[");
    const dark = css.indexOf(".dark\\:data-unchecked\\:bg-input\\/80");
    expect(plain).toBeGreaterThan(-1);
    expect(dark).toBeGreaterThan(plain);
  });

  it("compiles nothing for those classes without the plugin (the pre-fix config)", async () => {
    const config = loadConfig(configPath);
    const withoutPlugin = {
      ...config,
      plugins: (config.plugins ?? []).filter(
        (plugin) => !isDataVariantPlugin(plugin),
      ),
    };
    const classes = collectV4VariantClasses();
    const css = await compile(withoutPlugin, classes);

    const emitted = classes.filter((className) => hasRule(css, className));
    expect(
      emitted,
      "without the data-variant plugin these classes must compile to nothing, " +
        "which is exactly the bug this test guards",
    ).toEqual([]);
  });
});
