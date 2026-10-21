import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import resolveConfig from "tailwindcss/resolveConfig.js";

/**
 * Regression tests for #168, #175, #178 and #179: the shadcn "base-nova" ui
 * kit is written for **Tailwind v4**, but this repo runs **Tailwind v3.4**.
 * v4 understands a good deal of syntax v3 does not have at all, so every
 * class that uses one of them compiled to *nothing*:
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
 * - v4's *bare selector* variant (`[a]:`, `[svg]:`, `[.border-b]:`) is not a
 *   v3.4 spelling at all: v3.4 rejects an arbitrary variant that has no
 *   `&`, so the alert icon kept lucide's default 24px instead of the kit's
 *   16px and the card / dialog classes that use it were dead too (#178).
 *
 * The fix registers the v3 equivalents centrally in tailwind.config.ts,
 * defines the missing `--radius-*` variables in src/app/globals.css and
 * rewrites the bare-selector class strings the v3 way, so this test compiles
 * the classes the source actually uses with the repo's real config and
 * asserts each one emits a rule.
 *
 * #179 is a colour problem rather than a syntax problem, so it is guarded
 * here too: the destructive alert variant must not colour *text* with the
 * `--destructive` fill token, and the text it does use has to clear 4.5:1
 * against the alert's background in both themes.
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
const alertPath = fileURLToPath(
  new URL("../../src/components/ui/alert.tsx", import.meta.url),
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
  // v4: `text-underline-offset: 3px` (v3's scale stops at 0/1/2/4/8).
  "underline-offset-3",
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
  "textUnderlineOffset",
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
 * Drop the fragments the extractor produces.
 *
 * Tailwind's extractor yields a shortened match of every long class next to
 * the class itself (`**:focus:not-data-` next to the real
 * `**:focus:not-data-[variant=destructive]:text-accent-foreground`), and
 * those fragments are not class names. A candidate is a class name when its
 * utility part is a real Tailwind utility.
 */
async function realClasses(
  config: ReturnType<typeof loadConfig>,
  classes: string[],
): Promise<string[]> {
  const utilities = [
    ...new Set(classes.map((className) => splitCandidate(className).utility)),
  ];
  const css = await compile(config, utilities);
  return classes.filter((className) =>
    hasRule(css, splitCandidate(className).utility),
  );
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
 * The bare-selector variant is not skipped any more: it is gone from the
 * source (#178), and `collectBareSelectorClasses` below fails the build if it
 * ever comes back.
 */
function collectCombinatorClasses(): string[] {
  return collectClasses((variants) =>
    variants.some((part) => COMBINATOR_VARIANT_NAMES.includes(part))
      ? ""
      : undefined,
  );
}

/**
 * True for v4's "bare selector" variant (`[a]:`, `[svg]:`, `[.border-b]:`) —
 * an arbitrary variant without an `&`, which v3.4 rejects outright: it emits
 * no rule at all for `[.foo]:underline`, `[disabled]:opacity-50` and
 * `[svg]:size-4` alike.
 */
function isBareSelectorVariant(part: string): boolean {
  return part.startsWith("[") && part.endsWith("]") && !part.includes("&");
}

/**
 * Every class in `src/` that still uses v4's bare selector variant.
 *
 * The leading-`[` candidates are kept here (the ui kit's `[.border-b]:pb-4`
 * starts with a bracket), so the fragments the extractor yields from CSS
 * *selectors* rather than class names have to be told apart: the tabbable
 * selector in `use-dialog-tab-wrap.ts` yields `[contenteditable]:not`, which
 * is not a class name. A candidate only counts when its utility part is a
 * real Tailwind utility.
 */
async function collectBareSelectorClasses(
  config: ReturnType<typeof loadConfig>,
): Promise<string[]> {
  const bare = extractCandidates().filter((candidate) => {
    const { variants, utility } = splitCandidate(candidate);
    return Boolean(utility) && variants.some(isBareSelectorVariant);
  });
  if (!bare.length) return [];
  const classes = await realClasses(config, bare);
  return classes.sort();
}

/** Every source file the scan looks at. */
function sourceFiles(): string[] {
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
  return files;
}

/**
 * Strip the comments from a source file.
 *
 * The class surface of the app lives in code, not in prose, but the
 * extractor reads raw file content: a comment that *mentions* a class
 * (for example one that ends in a middle dot) yields fragments such as
 * `*:data-` that are not class names at all. Stripping the comments first
 * keeps the scan about the classes the app actually ships.
 */
function stripComments(source: string): string {
  let result = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const character = source[index];
    if (quote) {
      result += character;
      if (character === "\\") {
        result += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

/** Every candidate Tailwind's own extractor yields from `src/`. */
function extractCandidates(): string[] {
  const extract = defaultExtractor({
    tailwindConfig: { separator: ":", prefix: "" },
  });
  const candidates: string[] = [];
  for (const file of sourceFiles()) {
    candidates.push(
      ...extract(stripComments(fs.readFileSync(file, "utf8"))),
    );
  }
  return candidates;
}

/**
 * Walk `src/`, run Tailwind's own extractor over every source file and keep
 * the candidates the `pick` callback accepts.
 */
function collectClasses(
  pick: (variants: string[], utility: string) => string | undefined,
): string[] {
  const classes = new Set<string>();
  for (const candidate of extractCandidates()) {
    // A real class starts with a letter, with the `*` combinator or with an
    // arbitrary variant (`[&>svg]:size-4`); the extractor also yields
    // fragments such as "/switch:data-checked:translate-x-".
    if (!/^[[a-zA-Z*]/.test(candidate)) continue;
    const { variants, utility } = splitCandidate(candidate);
    if (!utility) continue;
    const picked = pick(variants, utility);
    if (picked !== undefined) classes.add(candidate);
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
  // The class name in the CSS is escaped, so a *longer* class that starts
  // with the same text is followed by a backslash — it must not count as a
  // rule for the shorter one.
  return new RegExp(`\\.${escaped}(?![a-zA-Z0-9_\\\\-])`).test(css);
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
    const classes = await realClasses(config, collectV4VariantClasses());
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
    const classes = await realClasses(config, collectV4VariantClasses());
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
    expect(utilityClasses).toContain("[&>a]:underline-offset-3");
    expect(utilityClasses).toContain(
      "data-[size=sm]:rounded-[min(var(--radius-md),10px)]",
    );
  });

  it("compiles every v4-only class used in src/ into a CSS rule", async () => {
    const config = loadConfig(configPath);
    const classes = await realClasses(config, [
      ...collectV4VariantClasses(),
      ...collectV4UtilityClasses(),
      ...collectCombinatorClasses(),
    ]);
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
      "underline-offset-3",
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
    // v4: `text-underline-offset: 3px`
    expect(css).toContain("text-underline-offset: 3px");
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
    const classes = await realClasses(config, [
      ...collectV4VariantClasses(),
      ...collectV4UtilityClasses(),
    ]).then((all) =>
      all.filter(
        // The `rounded-[min(var(--radius-md),10px)]` classes compile under v3
        // as well — they were broken by the missing CSS variable, not by a
        // missing rule (see the globals.css test above). The `*:` chains
        // compile as well: v3.4 ships the child variant, they were simply
        // written in the wrong order (see the selector assertions above).
        (className) => {
          const { utility } = splitCandidate(className);
          return !V4_RADIUS_VARIABLE_UTILITY.test(utility);
        },
      ),
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

/**
 * The v4 class strings the ui kit used before #178.
 *
 * v4's *bare selector* variant is an arbitrary variant without an `&`
 * (`[svg]:`, `[a]:`, `[.border-b]:`), which v3.4 does not understand at
 * all: it emits no rule for `[.foo]:underline` or `[disabled]:opacity-50`,
 * and where it does emit something it emits the *inner* utility unscoped
 * (`.size-4`, `.border-b`), which styles no element that carries the class.
 * The visible damage was the alert icon: it kept lucide's default 24px
 * instead of the kit's 16px and sat misaligned with the title.
 */
const V4_BARE_SELECTOR_CLASSES = [
  "*:[svg]:row-span-2",
  "*:[svg]:translate-y-0.5",
  "*:[svg]:text-current",
  "*:[svg:not([class*='size-'])]:size-4",
  "*:[img:first-child]:rounded-t-xl",
  "*:[img:last-child]:rounded-b-xl",
  "*:[a]:underline",
  "*:[a]:underline-offset-3",
  "*:[a]:hover:text-foreground",
  "[a]:hover:bg-primary/80",
  "[.border-b]:pb-4",
  "group-data-[size=sm]/card:[.border-b]:pb-3",
];

/**
 * The v3 rewrites of those class strings, one per file they came from.
 *
 * v4 applies a variant chain left to right to a moving target, so `*:[svg]:`
 * is `:is(.alert > *):is(svg)` — a direct child of the alert that is an
 * `<svg>` — and a bare `[a]:` is `&:is(a)`, the element itself. The v3
 * spelling has to name the child and the element in one selector, because
 * v3.4 hangs a chain's pseudo-classes off the *last* node of the selector.
 */
const V3_REWRITTEN_CLASSES = [
  // alert.tsx
  "[&>svg]:row-span-2",
  "[&>svg]:translate-y-0.5",
  "[&>svg]:text-current",
  "[&>svg:not([class*='size-'])]:size-4",
  // card.tsx
  "[&>img:first-child]:rounded-t-xl",
  "[&>img:last-child]:rounded-b-xl",
  "[&.border-b]:pb-4",
  "group-data-[size=sm]/card:[&.border-b]:pb-3",
  // dialog.tsx / alert-dialog.tsx
  "[&>a]:underline",
  "[&>a]:underline-offset-3",
  "[&>a]:hover:text-foreground",
  "[&>svg:not([class*='size-'])]:size-6",
  // badge.tsx / button.tsx
  "[&:is(a)]:hover:bg-primary/80",
];

describe("tailwind v4 bare-selector variants under tailwind v3 (issue #178)", () => {
  it("rewrote the ui kit's bare-selector classes the v3 way", () => {
    const candidates = new Set(extractCandidates());
    const missing = V3_REWRITTEN_CLASSES.filter(
      (className) => !candidates.has(className),
    );
    expect(
      missing,
      "these class strings are not in the source — write v4's bare-selector " +
        "variants the v3 way (`[&>svg]:…`), or the class compiles to nothing",
    ).toEqual([]);
  });

  it("uses no bare-selector variant anywhere in src/", async () => {
    const config = loadConfig(configPath);
    const bare = await collectBareSelectorClasses(config);
    expect(
      bare,
      "v3.4 rejects an arbitrary variant without an `&` — rewrite it as " +
        "`[&>…]` / `[&.foo]` / `[&:is(…)]`",
    ).toEqual([]);
  });

  it("compiles every rewritten class into a CSS rule", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, V3_REWRITTEN_CLASSES);
    const missing = V3_REWRITTEN_CLASSES.filter(
      (className) => !hasRule(css, className),
    );
    expect(missing).toEqual([]);
  });

  it("emits the selectors v4's spelling produces", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, V3_REWRITTEN_CLASSES);
    // v4: `:is(.alert > *):is(svg)` — a direct child that is an <svg>
    expect(css).toContain(">svg");
    // v4: `:is(.card > *):is(img:first-child)`
    expect(css).toContain(">img:first-child");
    // v4: `:is(.dialog > *):is(a)` — a direct child that is a link
    expect(css).toContain(">a");
    // v4: `&:is(a)` — the element itself is the link
    expect(css).toContain(":is(a)");
    // v4: `&:is(.border-b)` — the element itself carries the class
    expect(css).toContain(".border-b");
  });

  it("compiles the v4 spellings to nothing (the pre-fix behaviour)", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, V4_BARE_SELECTOR_CLASSES);
    expect(css).not.toContain(">svg");
    expect(css).not.toContain(">img:first-child");
    expect(css).not.toContain(">a");
    expect(css).not.toContain(":is(a)");
    expect(css).not.toContain("grid-row: span 2");
    expect(css).not.toContain("text-decoration-line: underline");
    expect(css).not.toContain("padding-bottom: 1rem");
    expect(css).not.toContain("padding-bottom: 0.75rem");
  });
});

/* ------------------------------------------------------------------ *
 * #179 — the destructive alert's text contrast.
 *
 * `--destructive` is a *fill* colour (red-500 in light, red-900 in dark).
 * As text it measured 3.44:1 on the light alert background and 1.97:1 on
 * the dark one, so the error title was unreadable. The destructive variant
 * therefore carries its own text colours, and this test proves they clear
 * 4.5:1 against the background the destructive alerts actually use.
 * ------------------------------------------------------------------ */

type Rgb = [number, number, number];

/** Resolve `rose-700` to the hex value the repo's tailwind config uses. */
function resolveColor(name: string): string {
  const config = resolveConfig(loadConfig(configPath));
  const colors = config.theme.colors as unknown as Record<string, unknown>;
  const [family, shade] = name.split("-");
  const palette = colors[family];
  const value =
    typeof palette === "string"
      ? palette
      : ((palette as Record<string, string> | undefined)?.[shade] ?? undefined);
  if (typeof value !== "string" || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new Error(
      `"${name}" does not resolve to a hex colour (got ${JSON.stringify(value)}). ` +
        "The destructive alert must not colour text with a theme token: the " +
        "--destructive token is a fill colour and is unreadable as text.",
    );
  }
  return value;
}

function hexToRgb(hex: string): Rgb {
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex.slice(1);
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r, g, b].map((value) => Math.round((value + m) * 255)) as Rgb;
}

/** The page background in dark mode, read from globals.css. */
function darkPageBackground(): Rgb {
  const globals = fs.readFileSync(globalsPath, "utf8");
  const dark = globals.slice(globals.indexOf(".dark {"));
  const match = dark.match(
    /--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/,
  );
  if (!match) throw new Error("--background is not defined in the dark theme");
  return hslToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Paint a translucent colour over an opaque one, the way the browser does. */
function composite(colour: Rgb, alpha: number, background: Rgb): Rgb {
  return colour.map(
    (channel, index) =>
      Math.round(alpha * channel + (1 - alpha) * background[index]),
  ) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG 2.1 contrast ratio between two opaque colours. */
function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The class names of the destructive alert variant, read from the source. */
function destructiveAlertClasses(): string[] {
  const source = fs.readFileSync(alertPath, "utf8");
  const match = source.match(/destructive:\s*"([^"]+)"/);
  if (!match) {
    throw new Error("the destructive alert variant was not found in alert.tsx");
  }
  return match[1].split(/\s+/).filter(Boolean);
}

/** The colour a `text-*` class sets, with the alpha of its `/90` suffix. */
function textColour(className: string): { name: string; alpha: number } {
  const { utility } = splitCandidate(className);
  const match = /^text-(.+?)(?:\/(\d+))?$/.exec(utility);
  if (!match) {
    throw new Error(`"${className}" is not a text colour class`);
  }
  return {
    name: match[1],
    alpha: match[2] ? Number(match[2]) / 100 : 1,
  };
}

describe("the destructive alert's text contrast (issue #179)", () => {
  const classes = destructiveAlertClasses();

  /** The text colour the variant sets for the given variant chain. */
  function colourWhere(
    matches: (variants: string[]) => boolean,
  ): { name: string; alpha: number } {
    const className = classes.find((candidate) => {
      const { variants, utility } = splitCandidate(candidate);
      return utility.startsWith("text-") && matches(variants);
    });
    if (!className) {
      throw new Error("the destructive alert variant sets no such text colour");
    }
    return textColour(className);
  }

  it("does not colour the alert text with the destructive fill token", () => {
    const fills = classes.filter((className) =>
      /(^|:)text-destructive(\/|$)/.test(className),
    );
    expect(
      fills,
      "the --destructive token is a fill colour — red-500 in light and " +
        "red-900 in dark measure 3.44:1 and 1.97:1 as text",
    ).toEqual([]);
  });

  it("gives the title and the description 4.5:1 or better in both themes", () => {
    // The destructive alerts in the app paint themselves
    // `bg-red-50 dark:bg-red-950/20`; the light background is the page
    // override, the card background (`bg-card`, white) is the other one in
    // play, and the dark background is red-950 at 20% over the page.
    const login = fs.readFileSync(
      path.join(repoRoot, "src/app/(auth)/login/page.tsx"),
      "utf8",
    );
    expect(login).toContain("bg-red-50 dark:bg-red-950/20");

    const lightBackgrounds = [hexToRgb(resolveColor("red-50")), hexToRgb(resolveColor("white"))];
    const darkBackground = composite(
      hexToRgb(resolveColor("red-950")),
      0.2,
      darkPageBackground(),
    );

    const titleLight = colourWhere((variants) => variants.length === 0);
    const titleDark = colourWhere(
      (variants) => variants.length === 1 && variants[0] === "dark",
    );
    const descriptionLight = colourWhere(
      (variants) =>
        variants.includes("data-[slot=alert-description]") &&
        !variants.includes("dark"),
    );
    const descriptionDark = colourWhere(
      (variants) =>
        variants.includes("data-[slot=alert-description]") &&
        variants.includes("dark"),
    );

    for (const background of lightBackgrounds) {
      const title = composite(
        hexToRgb(resolveColor(titleLight.name)),
        titleLight.alpha,
        background,
      );
      const description = composite(
        hexToRgb(resolveColor(descriptionLight.name)),
        descriptionLight.alpha,
        background,
      );
      expect(
        contrastRatio(title, background),
        `the destructive title (${titleLight.name}) is unreadable on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(description, background),
        `the destructive description (${descriptionLight.name}) is unreadable on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    const darkTitle = composite(
      hexToRgb(resolveColor(titleDark.name)),
      titleDark.alpha,
      darkBackground,
    );
    const darkDescription = composite(
      hexToRgb(resolveColor(descriptionDark.name)),
      descriptionDark.alpha,
      darkBackground,
    );
    expect(
      contrastRatio(darkTitle, darkBackground),
      `the destructive title (${titleDark.name}) is unreadable in dark mode`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(darkDescription, darkBackground),
      `the destructive description (${descriptionDark.name}) is unreadable in dark mode`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("styles the description element itself, not its children", async () => {
    const config = loadConfig(configPath);
    const css = await compile(config, [
      "data-[slot=alert-description]:*:text-rose-700/90",
      "dark:data-[slot=alert-description]:*:text-rose-300/90",
    ]);
    // v3.4 hangs a chain's pseudo-classes off the *last* node of the
    // selector, so the chain has to be written the other way round: the
    // description element is the child that carries the data attribute.
    expect(css).toContain('> *[data-slot="alert-description"]');
    expect(css).not.toContain('[data-slot="alert-description"] > *');
  });
});
