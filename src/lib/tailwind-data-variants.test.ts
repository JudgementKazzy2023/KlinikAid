import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";

/**
 * Regression tests for #168 and #175: the shadcn "base-nova" ui kit is
 * written for **Tailwind v4**, but this repo runs **Tailwind v3.4**. v4
 * understands a good deal of syntax v3 does not have at all, so every class
 * that uses one of them compiled to *nothing*:
 *
 * - the dialog / alert-dialog / sheet open-close transitions never ran
 *   (`data-open:`, `data-closed:`, `data-starting-style:`, `data-ending-style:`),
 * - the switch never changed colour (`data-checked:` / `data-unchecked:`),
 * - the select item, icon padding and button-group rounding fell back to their
 *   defaults (`has-data-[…]:`, `in-data-[…]:`),
 * - the negated data attribute, the `aria-expanded` container query, the
 *   child/descendant combinators, the `utility-(--css-var)` shorthand, the
 *   `outline-hidden` / `field-sizing-content` / `rounded-4xl` /
 *   `backdrop-blur-xs` utilities and the `--radius-*` theme variables all
 *   vanished (`not-data-[…]:`, `has-aria-expanded:`, `*:` / `**:`, …).
 *
 * The fix registers the v3 equivalents centrally in tailwind.config.ts and
 * defines the missing `--radius-*` variables in src/app/globals.css, so this
 * test compiles the classes the source actually uses with the repo's real
 * config and asserts each one emits a rule.
 *
 * Known gap: v4's *bare selector* variant (`[a]:`, `[svg]:`,
 * `[img:first-child]:`) is not covered — v3.4 rejects an arbitrary variant
 * without an `&`, so the ui kit's alert / card / dialog classes that use it
 * are still dead and are skipped by the scan below.
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
const globalsPath = fileURLToPath(
  new URL("../../src/app/globals.css", import.meta.url),
);

/**
 * The Tailwind v4 variant families the ui kit uses and Tailwind v3 does not
 * understand. The bare `data-<state>:` forms are matched generically (see
 * `isV4Variant`), so a state the kit does not use yet is still caught.
 * `data-[…]:` (bracketed) is deliberately *not* matched: v3 supports that form
 * natively.
 */
const V4_VARIANT_NAMES = [
  "in-data",
  "has-data",
  "group-has-data",
  // #175: the negated data/attribute variants, the `aria-expanded` container
  // query, the descendant combinator and the named `supports-…` variant.
  "not-data",
  "not-aria",
  "has-aria",
  "not-first",
  "not-last",
  "not-only",
  "not-empty",
  "supports-backdrop-filter",
  "**",
];

/**
 * The child/descendant combinator variants. `*:` (`& > *`) is native to
 * v3.4, `**:` (`& *`) is v4 only — but v3.4 hangs a variant chain's
 * pseudo-classes off the *last* node of the selector, so a chain that puts
 * the combinator first styles the wrong element. The classes that use one
 * therefore have to be written the other way round; the assertions below pin
 * the resulting selectors.
 */
const COMBINATOR_VARIANT_NAMES = ["*", "**"];

/**
 * Tailwind v4 utilities the ui kit uses that Tailwind v3.4 has no rule for.
 * They are registered centrally in tailwind.config.ts (as a theme key or via
 * `addUtilities`).
 */
const V4_UTILITY_NAMES = [
  // v4: `outline-style: none` (v3 only knows `outline-none`, which draws a
  // transparent 2px outline instead).
  "outline-hidden",
  // v4: `field-sizing: content`.
  "field-sizing-content",
  // v4: `border-radius: var(--radius-4xl)` (2rem).
  "rounded-4xl",
  // v4: `backdrop-filter: blur(var(--blur-xs))` (4px).
  "backdrop-blur-xs",
];

/** v4's `utility-(--css-var)` shorthand, e.g. `max-h-(--available-height)`. */
const V4_CSS_VARIABLE_UTILITY = /-(\(--[a-z0-9-]+\))$/;

/**
 * v4's `rounded-[min(var(--radius-md),10px)]` idiom. The class itself
 * compiles under v3 — but `--radius-md` is a v4 theme variable this repo
 * never defined, so the declaration was invalid at computed-value time and the
 * corner radius silently fell back to `0`.
 */
const V4_RADIUS_VARIABLE_UTILITY =
  /^rounded-\[min\(var\(--radius-[a-z0-9]+\),\d+px\)\]$/;

/**
 * Marker that identifies the plugin in tailwind.config.ts, so the "before the
 * fix" config can be rebuilt from the real one. The plugin registers the
 * `data-starting-style` variant, so its source always mentions it.
 */
const DATA_VARIANT_PLUGIN_MARKER = "data-starting-style";

/**
 * The theme keys tailwind.config.ts adds for the v4-only utilities. Removing
 * them rebuilds the pre-#175 configuration.
 */
const V4_THEME_KEYS = [
  "maxHeight",
  "width",
  "transformOrigin",
  "backdropBlur",
] as const;

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

/** True when the utility part of a candidate is one of the v4-only utilities. */
function isV4Utility(utility: string): boolean {
  if (V4_UTILITY_NAMES.includes(utility)) return true;
  if (V4_CSS_VARIABLE_UTILITY.test(utility)) return true;
  return V4_RADIUS_VARIABLE_UTILITY.test(utility);
}

/**
 * Every class in `src/` that uses one of the v4-only variants. The list is
 * derived from the source, so a new use in the ui kit is covered
 * automatically.
 */
function collectV4VariantClasses(): string[] {
  return collectClasses((variants, utility) =>
    variants.some(isV4Variant) ? utility : undefined,
  );
}

/**
 * Every class in `src/` whose utility is one of the v4-only utilities
 * (`outline-hidden`, `max-h-(--available-height)`, …).
 */
function collectV4UtilityClasses(): string[] {
  return collectClasses((_variants, utility) =>
    isV4Utility(utility) ? utility : undefined,
  );
}

/**
 * Every class in `src/` that uses the `*:` / `**:` combinator variants.
 *
 * v4's *bare selector* variant (`[a]:`, `[svg]:`, `[img:first-child]:`) is
 * skipped: v3.4 only understands an arbitrary variant that contains an `&`,
 * so those classes are still dead under v3.4 and fixing them means rewriting
 * six class strings in alert.tsx / card.tsx / dialog.tsx and changing the
 * size of the alert icon — a separate change with its own visual review.
 */
function collectCombinatorClasses(): string[] {
  return collectClasses((variants) =>
    variants.some((part) => COMBINATOR_VARIANT_NAMES.includes(part)) &&
      !variants.some(isBareSelectorVariant)
      ? ""
      : undefined,
  );
}

/**
 * True for v4's "bare selector" variant (`[a]:`, `[svg]:`,
 * `[svg:not([class*='size-'])]:`) — an arbitrary variant without an `&`,
 * which v3.4 rejects.
 */
function isBareSelectorVariant(part: string): boolean {
  return part.startsWith("[") && part.endsWith("]") && !part.includes("&");
}

/**
 * Walk `src/`, run Tailwind's own extractor over every source file and keep
 * the candidates the `pick` callback accepts.
 */
function collectClasses(
  pick: (variants: string[], utility: string) => string | undefined,
): string[] {
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
      // A real class starts with a letter (or with the `*` combinator); the
      // extractor also yields fragments such as "/switch:data-checked:translate-x-".
      if (!/^[a-zA-Z*]/.test(candidate)) continue;
      const { variants, utility } = splitCandidate(candidate);
      if (!utility) continue;
      const picked = pick(variants, utility);
      if (picked !== undefined) classes.add(candidate);
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

/**
 * The repo's config *without* the v4 shims: neither the plugin (which holds
 * the variants and the `addUtilities` rules) nor the theme keys the v4-only
 * utilities need. This is the configuration the repo had before #168/#175,
 * and the one the "before" assertions compile against.
 */
function withoutV4Shims(config: ReturnType<typeof loadConfig>) {
  const extend: Record<string, unknown> = {
    ...((config.theme as { extend?: Record<string, unknown> })?.extend ?? {}),
  };
  for (const key of V4_THEME_KEYS) delete extend[key];
  const borderRadius = extend.borderRadius as Record<string, string> | undefined;
  if (borderRadius) {
    const rest = { ...borderRadius };
    delete rest["4xl"];
    extend.borderRadius = rest;
  }
  return {
    ...config,
    theme: { ...(config.theme as object), extend },
    plugins: (config.plugins ?? []).filter(
      (plugin) => !isDataVariantPlugin(plugin),
    ),
  };
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

describe("tailwind v4-only syntax under tailwind v3 (issue #175)", () => {
  it("finds the v4-only classes the ui kit uses", () => {
    const variantClasses = collectV4VariantClasses();
    expect(variantClasses).toContain(
      "**:focus:not-data-[variant=destructive]:text-accent-foreground",
    );
    expect(variantClasses).toContain("has-aria-expanded:bg-muted/50");
    expect(variantClasses).toContain("supports-backdrop-filter:backdrop-blur-xs");

    const combinatorClasses = collectCombinatorClasses();
    expect(combinatorClasses).toContain("data-[slot=select-value]:*:line-clamp-1");
    expect(combinatorClasses).toContain("last:[&:is(span)]:*:flex");

    const utilityClasses = collectV4UtilityClasses();
    expect(utilityClasses).toContain("outline-hidden");
    expect(utilityClasses).toContain("field-sizing-content");
    expect(utilityClasses).toContain("rounded-4xl");
    expect(utilityClasses).toContain(
      "supports-backdrop-filter:backdrop-blur-xs",
    );
    expect(utilityClasses).toContain("max-h-(--available-height)");
    expect(utilityClasses).toContain("w-(--anchor-width)");
    expect(utilityClasses).toContain("origin-(--transform-origin)");
    expect(utilityClasses).toContain(
      "data-[size=sm]:rounded-[min(var(--radius-md),10px)]",
    );
  });

  it("compiles every v4-only class used in src/ into a CSS rule", async () => {
    const config = loadConfig(configPath);
    const classes = [
      ...collectV4VariantClasses(),
      ...collectV4UtilityClasses(),
      ...collectCombinatorClasses(),
    ];
    const css = await compile(config, classes);

    const missing = classes.filter((className) => !hasRule(css, className));
    expect(
      missing,
      "these v4-only classes compile to nothing — register the v3 " +
        "equivalent in tailwind.config.ts, or define the missing theme " +
        "variable in src/app/globals.css",
    ).toEqual([]);
  });

  it("emits the selectors the kit intends", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, [
      "not-data-[variant=destructive]:text-accent-foreground",
      "not-aria-[haspopup]:translate-y-px",
      "not-first:text-accent-foreground",
      "not-last:text-accent-foreground",
      "not-only:text-accent-foreground",
      "not-empty:text-accent-foreground",
      "has-aria-expanded:bg-muted/50",
      "has-aria-[label=\"Close\"]:bg-muted/50",
      "**:focus:not-data-[variant=destructive]:text-accent-foreground",
      "data-[slot=select-value]:*:line-clamp-1",
      "last:[&:is(span)]:*:flex",
      "supports-backdrop-filter:backdrop-blur-xs",
      "outline-hidden",
      "field-sizing-content",
      "rounded-4xl",
      "backdrop-blur-xs",
      "max-h-(--available-height)",
      "w-(--anchor-width)",
      "origin-(--transform-origin)",
    ]);

    // v4: `&:not([data-variant="destructive"])`
    expect(css).toContain(':not([data-variant="destructive"])');
    // v4: `&:not([aria-haspopup])`
    expect(css).toContain(':not([aria-haspopup])');
    // v4: `&:not(:first-child)` and friends
    expect(css).toContain(":not(:first-child)");
    expect(css).toContain(":not(:last-child)");
    expect(css).toContain(":not(:only-child)");
    expect(css).toContain(":not(:empty)");
    // v4: `&:has([aria-expanded="true"])`
    expect(css).toContain(':has([aria-expanded="true"])');
    // v4: `&:has([aria-label="Close"])`
    expect(css).toContain(':has([aria-label="Close"])');
    // v4: `& *` — the descendant of a focused, non-destructive item
    expect(css).toContain("):focus *");
    // v4: `& > *` — the direct child that carries the data attribute
    expect(css).toContain('> *[data-slot="select-value"]');
    // v4: `& > *:is(span):last-child`
    expect(css).toContain("> *:is(span):last-child");
    // v4: `@supports (backdrop-filter: var(--tw))`
    expect(css).toContain("@supports (backdrop-filter: var(--tw))");
    // v4: `outline-style: none`
    expect(css).toContain("outline-style: none");
    // v4: `field-sizing: content`
    expect(css).toContain("field-sizing: content");
    // v4: `border-radius: var(--radius-4xl)` (2rem)
    expect(css).toContain("border-radius: 2rem");
    // v4: `blur(var(--blur-xs))` (4px)
    expect(css).toContain("blur(4px)");
    // v4: `max-height: var(--available-height)` and friends
    expect(css).toContain("max-height: var(--available-height)");
    expect(css).toContain("width: var(--anchor-width)");
    expect(css).toContain("transform-origin: var(--transform-origin)");
  });

  it("defines the --radius-* variables the v4 theme derives from --radius", () => {
    const globals = fs.readFileSync(globalsPath, "utf8");
    // v4's shadcn theme derives these from --radius; without them the kit's
    // `rounded-[min(var(--radius-md),10px)]` is invalid at computed-value time
    // and the corner radius silently falls back to 0.
    expect(globals).toContain("--radius-sm: calc(var(--radius) - 4px)");
    expect(globals).toContain("--radius-md: calc(var(--radius) - 2px)");
    expect(globals).toContain("--radius-lg: var(--radius)");
    expect(globals).toContain("--radius-xl: calc(var(--radius) + 4px)");
  });

  it("compiles nothing for those classes without the v4 shims (the pre-fix config)", async () => {
    const config = loadConfig(configPath);
    const before = withoutV4Shims(config);
    const classes = [
      ...collectV4VariantClasses(),
      ...collectV4UtilityClasses(),
    ].filter(
      // The `rounded-[min(var(--radius-md),10px)]` classes compile under v3
      // as well — they were broken by the missing CSS variable, not by a
      // missing rule (see the globals.css test above). The `*:` chains
      // compile as well: v3.4 ships the child variant, they were simply
      // written in the wrong order (see the selector assertions above).
      (className) => {
        const { utility } = splitCandidate(className);
        return !V4_RADIUS_VARIABLE_UTILITY.test(utility);
      },
    );
    const css = await compile(before, classes);

    const emitted = classes.filter((className) => hasRule(css, className));
    expect(
      emitted,
      "without the v4 shims these classes must compile to nothing, which is " +
        "exactly the bug this test guards",
    ).toEqual([]);
  });
});
