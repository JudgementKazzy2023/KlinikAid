import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import ts from "typescript";
import defaultTheme from "tailwindcss/defaultTheme.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as focusRingModule from "./focus-ring";

/**
 * Issue #180: 26 hand-written `<button>` elements in `src/` declared no focus
 * style at all, so keyboard focus painted only the browser's 1px default
 * outline — invisible against the beige and dark backgrounds. A few more
 * declared a 2px ring or a 2px outline.
 *
 * The rule this file enforces:
 *
 *   every interactive control in src/ paints a focus indicator of at least
 *   3px on keyboard focus
 *
 * A control is compliant when it carries a focus style whose ring or outline
 * width is 3px or more, or when it uses the shared `focusRingClass`
 * (`src/lib/focus-ring.ts`), which is the ui kit's own 3px ring.
 *
 * The check is source-level because the unit tests run in node without a DOM.
 * The elements are found with the TypeScript parser rather than a regex:
 * a `<button onClick={() => ...}>` contains a `>` inside the handler, which
 * ends the tag for a regex but not for the parser.
 */

/**
 * The interactive elements this guard covers.
 *
 * Only raw `<button>` elements are guarded. Links and form controls are
 * covered by the app-wide `:focus-visible` rule in `src/app/globals.css`,
 * which paints a 3px outline on anything that does not declare a focus style
 * of its own. A button is held to the stricter rule on purpose: it is the
 * shape the issue listed, and a button that carries the shared class paints
 * the same ring as the ui kit's buttons next to it.
 */
const GUARDED_TAGS = new Set(["button"]);

/**
 * The shared constant's export names, so an alias import still counts.
 */
const SHARED_NAMES = new Set(Object.keys(focusRingModule));

/**
 * The shared indicator for a control that a clipping edge can cut off
 * (issue #192). It draws the 3px outline *inside* the control's own box, so
 * no ancestor's `overflow` can cut it off.
 */
const INSET_SHARED_NAME = "focusRingInsetClass";

/**
 * The ui kit's own variant helper. `buttonVariants()` always includes the
 * kit's 3px focus ring, so a control styled through it is compliant.
 */
const KIT_VARIANT_HELPERS = new Set(["buttonVariants"]);

const SRC_ROOT = join(__dirname, "..");

/** The project's Tailwind config, for the theme values the rules depend on. */
const tailwindConfig = loadConfig(
  fileURLToPath(new URL("../../tailwind.config.ts", import.meta.url))
);

/** Every .tsx file under src/. */
function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...tsxFiles(path));
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Every .ts and .tsx file under src/, except this guard's own source. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if ((path.endsWith(".ts") || path.endsWith(".tsx")) && !path.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

/** The px width a Tailwind width token stands for, or null when it is not one. */
function widthOf(token: string): number | null {
  const plain = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(token);
  if (plain) return Number(plain[1]);
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  return null;
}

/**
 * The ring width `ring` (no number) paints: the theme's `ringWidth.DEFAULT`.
 * Tailwind v3's default theme ships 3px, so a bare `focus:ring` is a 3px
 * ring - the same width the rest of the app uses - and the project's config
 * may override it.
 */
const DEFAULT_RING_WIDTH = (() => {
  const theme = tailwindConfig.theme as
    | { ringWidth?: Record<string, string>; extend?: { ringWidth?: Record<string, string> } }
    | undefined;
  const width =
    theme?.extend?.ringWidth?.DEFAULT ??
    theme?.ringWidth?.DEFAULT ??
    defaultTheme.ringWidth.DEFAULT;
  const px = widthOf(width);
  return px === null ? 1 : px;
})();

/**
 * The widest focus ring (a `focus:ring-<width>` utility) a class list
 * declares, in px, or null when it declares no focus ring.
 *
 * A ring *colour* on its own (`focus:ring-indigo-500`) paints nothing in
 * Tailwind v3: the width utility is what sets the ring's box shadow, so the
 * colour alone leaves the element with no ring of its own. `focus:ring` with
 * no number paints the theme's default width.
 */
export function focusRingWidth(classNames: string[]): number | null {
  let widest: number | null = null;
  for (const token of classNames) {
    const ring = /^focus(?:-visible)?:ring(?:-(.+))?$/.exec(token);
    if (!ring) continue;
    const width = ring[1] === undefined ? DEFAULT_RING_WIDTH : widthOf(ring[1]);
    if (width !== null) widest = Math.max(widest ?? 0, width);
  }
  return widest;
}

/**
 * The widest focus ring or focus outline a class list declares, in px, or null
 * when it declares no focus indicator at all.
 *
 * `focus:ring-2` is 2px and does not qualify. `focus:ring-3` does — the
 * Tailwind config adds `ringWidth: { 3: "3px" }` for it (issue #149).
 * `focus:ring` with no number is the theme's default width, which in
 * Tailwind v3 is 3px, so it qualifies too. `focus:outline` on its own only
 * sets the outline *style*; the width stays the browser's 1px, so it does
 * not qualify either.
 */
export function focusIndicatorWidth(classNames: string[]): number | null {
  let widest = focusRingWidth(classNames);
  for (const token of classNames) {
    const outline = /^focus(?:-visible)?:outline-(.+)$/.exec(token);
    if (outline) {
      const width = widthOf(outline[1]);
      if (width !== null) widest = Math.max(widest ?? 0, width);
    }
  }
  return widest;
}

/** The class names a `className` attribute contributes, plus whether it uses the shared constant. */
function classNamesOf(
  attribute: ts.JsxAttribute,
  source: ts.SourceFile
): { names: string[]; shared: string[] } {
  const names: string[] = [];
  const shared: string[] = [];

  const initializer = attribute.initializer;
  if (!initializer) return { names, shared };
  if (ts.isStringLiteral(initializer)) {
    names.push(...initializer.text.split(/\s+/).filter(Boolean));
    return { names, shared };
  }
  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return { names, shared };
  }

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      names.push(...node.text.split(/\s+/).filter(Boolean));
      return;
    }
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      names.push(...node.text.split(/\s+/).filter(Boolean));
      return;
    }
    if (ts.isIdentifier(node) && SHARED_NAMES.has(node.text)) {
      shared.push(node.text);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      KIT_VARIANT_HELPERS.has(node.expression.text)
    ) {
      shared.push(node.expression.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer.expression);
  void source;
  return { names, shared };
}

type Offender = {
  file: string;
  line: number;
  tag: string;
  classes: string;
};

/** Every guarded element that declares no focus indicator of at least 3px. */
function findOffenders(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of tsxFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        GUARDED_TAGS.has(node.tagName.getText(source))
      ) {
        const attribute = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === "className"
        );
        const { names, shared } = attribute
          ? classNamesOf(attribute, source)
          : { names: [] as string[], shared: [] as string[] };
        const width = focusIndicatorWidth(names);
        if (shared.length === 0 && (width === null || width < 3)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          offenders.push({
            file: file.slice(SRC_ROOT.length + 1),
            line: line + 1,
            tag: node.tagName.getText(source),
            classes: names.join(" ") || "(no className)",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return offenders;
}

/**
 * Every element that paints its own focus ring but does not keep the app-wide
 * outline floor away, or that paints a ring under 3px.
 *
 * The floor in `src/app/globals.css` is
 *
 *   :focus-visible:not(.outline-none):focus { outline: 3px solid hsl(var(--ring)); outline-offset: 2px; }
 *
 * so a control that carries a focus ring and does not carry the unprefixed
 * `outline-none` class gets that 3px outline *and* its own ring: two
 * indicators where every other control shows one (issue #187).
 *
 * `focus:outline-none` is not the opt-out. The floor's `:not(.outline-none)`
 * does not match it, and the floor's own rule outranks it, so a control with
 * `focus:outline-none` and a ring still gets the floor's outline on top of
 * its ring.
 */
function findRingOffenders(): (Offender & { reason: string })[] {
  const offenders: (Offender & { reason: string })[] = [];
  for (const file of tsxFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attribute = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === "className"
        );
        const { names } = attribute
          ? classNamesOf(attribute, source)
          : { names: [] as string[] };
        const ring = focusRingWidth(names);
        // A ring of 0px paints nothing, so it is not an indicator of its own.
        if (ring !== null && ring > 0) {
          const reason = names.includes("outline-none")
            ? ring < 3
              ? `paints a ${ring}px focus ring, which is under the 3px floor`
              : null
            : "paints a focus ring without `outline-none`, so the app-wide 3px outline floor paints a second indicator";
          if (reason) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            offenders.push({
              file: file.slice(SRC_ROOT.length + 1),
              line: line + 1,
              tag: node.tagName.getText(source),
              classes: names.join(" ") || "(no className)",
              reason,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return offenders;
}

/**
 * One element of `src/`, with the class names it ends up with.
 *
 * `names` are the class names written at the call site; `shared` are the
 * shared constants the call site uses, which stand for a list of class names
 * of their own.
 */
type Element = {
  file: string;
  line: number;
  tag: string;
  names: string[];
  shared: string[];
};

/** Every element in `src/` that declares a class name. */
function elementsWithClasses(): Element[] {
  const elements: Element[] = [];
  for (const file of tsxFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attribute = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === "className"
        );
        if (attribute) {
          const { names, shared } = classNamesOf(attribute, source);
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          elements.push({
            file: file.slice(SRC_ROOT.length + 1),
            line: line + 1,
            tag: node.tagName.getText(source),
            names,
            shared,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return elements;
}

/** The class names a shared constant stands for. */
function sharedTokens(name: string): string[] {
  const value = (focusRingModule as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

/** The class names an element ends up with, the shared constants expanded. */
function effectiveNames(element: Element): string[] {
  return [
    ...element.names,
    ...element.shared.flatMap((name) => sharedTokens(name)),
  ];
}

/** A Tailwind utility that turns an element into a scroll region. */
function isScrollUtility(name: string): boolean {
  return /^overflow(-[xy])?-(auto|scroll)$/.test(name);
}

/**
 * Every scroll utility used in `src/`.
 *
 * The list is read from the source rather than from a fixed set, so a new
 * utility (`overflow-y-scroll`, say) is caught by the guard instead of
 * slipping past it.
 */
function usedScrollUtilities(): Set<string> {
  const used = new Set<string>();
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\boverflow(?:-[xy])?-(?:auto|scroll)\b/g)) {
      used.add(match[0]);
    }
  }
  return used;
}

/** The app-wide stylesheet, where the focus indicator's rules live. */
const GLOBALS_CSS = join(SRC_ROOT, "app", "globals.css");

/** One CSS rule, with its declarations. */
type CssRule = { selector: string; decls: Record<string, string> };

/** Every rule in `src/app/globals.css`. */
function globalRules(): CssRule[] {
  const rules: CssRule[] = [];
  postcss.parse(readFileSync(GLOBALS_CSS, "utf8")).walkRules((rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((decl) => {
      decls[decl.prop] = decl.value;
    });
    rules.push({ selector: rule.selector, decls });
  });
  return rules;
}

/**
 * The app-wide rule that draws the focus indicator of a scroll region
 * *inside* the region, so a clipping ancestor cannot cut it off.
 */
function scrollRegionRule(): CssRule | undefined {
  return globalRules().find(
    (rule) =>
      (rule.decls["outline-offset"] ?? "").startsWith("-") &&
      (rule.decls["outline"] ?? "").includes("hsl(var(--ring))")
  );
}

/** The app-wide floor: the 3px outline every focusable control falls back on. */
function focusFloorRule(): CssRule | undefined {
  return globalRules().find((rule) => rule.decls["outline-offset"] === "2px");
}

/**
 * A rough count of a selector's specificity: the class, attribute and
 * pseudo-class parts. `:not(...)` counts as its argument alone (CSS
 * Selectors 3). Ids and element names are not counted, because the two rules
 * this guard compares differ only in that count.
 */
function specificity(selector: string): number {
  const parts = (text: string): number =>
    (text.match(/\.[\w-]+/g) ?? []).length +
    (text.match(/\[[^\]]+\]/g) ?? []).length +
    (text.match(/:[\w-]+/g) ?? []).length;
  const argumentsOfNot = [...selector.matchAll(/:not\(([^)]*)\)/g)].map((match) => match[1]);
  const bare = selector.replace(/:not\([^)]*\)/g, "");
  return parts(bare) + argumentsOfNot.reduce((sum, argument) => sum + parts(argument), 0);
}

describe("focus indicator (issue #180)", () => {
  it("declares the shared focus ring as a 3px ring", async () => {
    const config = tailwindConfig;
    const css = (
      await postcss([
        tailwindcss({
          ...config,
          content: [
            { raw: `<div class="${focusRingModule.focusRingClass}"></div>`, extension: "html" },
          ],
        }),
      ]).process("@tailwind utilities;", { from: undefined })
    ).css;

    const ringBlock = css
      .split("}")
      .map((block) => block + "}")
      .find((block) => block.includes(".focus-visible\\:ring-3"));
    expect(ringBlock, "`.ring-3` must exist in the Tailwind v3 config").toBeDefined();
    expect(ringBlock).toContain(
      "--tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color)"
    );

    const colourBlock = css
      .split("}")
      .map((block) => block + "}")
      .find((block) => block.includes(".focus-visible\\:ring-ring\\/50"));
    expect(colourBlock).toBeDefined();
    expect(colourBlock).toContain("--tw-ring-color: hsl(var(--ring) / 0.5)");
  });

  it("gives every raw button in src/ a focus indicator of at least 3px", () => {
    const offenders = findOffenders();
    expect(
      offenders,
      `These interactive elements have no focus indicator of 3px or more:\n${offenders
        .map((offender) => `  ${offender.file}:${offender.line} <${offender.tag}> ${offender.classes}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("reads a focus ring width, and does not mistake a ring colour for one", () => {
    expect(focusRingWidth(["focus:ring-3", "focus:ring-indigo-500"])).toBe(3);
    expect(focusRingWidth(["focus-visible:ring-3"])).toBe(3);
    expect(focusRingWidth(["focus:ring-2"])).toBe(2);
    // `focus:ring` with no number is the theme's default width: 3px in
    // Tailwind v3, so it is an indicator like `focus:ring-3`.
    expect(focusRingWidth(["focus:ring"])).toBe(3);
    expect(focusRingWidth(["focus-visible:ring"])).toBe(3);
    // A ring colour on its own paints nothing in Tailwind v3.
    expect(focusRingWidth(["focus:ring-indigo-500"])).toBeNull();
    // A ring that is not tied to focus is decoration, not an indicator.
    expect(focusRingWidth(["ring-3"])).toBeNull();
    // Neither is the ring's inset flag or its offset.
    expect(focusRingWidth(["focus:ring-inset"])).toBeNull();
    expect(focusRingWidth(["focus:ring-offset-2"])).toBeNull();
  });

  it("keeps a control that paints its own ring to a single indicator", () => {
    const offenders = findRingOffenders();
    expect(
      offenders,
      `These elements paint a focus ring that collides with the app-wide outline floor:\n${offenders
        .map(
          (offender) =>
            `  ${offender.file}:${offender.line} <${offender.tag}> ${offender.classes}\n      ${offender.reason}`
        )
        .join("\n")}`
    ).toEqual([]);
  });
});

/**
 * Issue #192: a focus indicator that a clipping edge cuts off.
 *
 * The rule this file enforces, on top of the ones above:
 *
 *   a focus indicator is never painted where a clipping edge can cut it
 *
 * An indicator is painted *outside* the control's border box (the shared
 * ring, the app-wide outline floor with its 2px offset), which is exactly
 * where a scroll region, an `overflow-hidden` wrapper or the edge of the
 * viewport clips. Three places lost their indicator that way: the first card
 * of a kanban column, the System Event Log scroller on /admin/dashboard and
 * the table scroller on /admin/logs.
 *
 * The way out is to draw the indicator *inside* the control's own box:
 *
 *   - a scroll region gets it from the app-wide rule in
 *     `src/app/globals.css`, which paints the outline at a negative offset;
 *   - a control that opts out of that rule (it carries `outline-none`, so
 *     the rule does not match it) draws it itself, with the shared
 *     `focusRingInsetClass`.
 */
describe("focus indicator a clipping edge cannot cut (issue #192)", () => {
  it("declares the shared inset indicator as a 3px outline drawn inside the control", async () => {
    const inset = focusRingModule[INSET_SHARED_NAME] as string;
    // The floor's `:not(.outline-none)` has to let this control through, and
    // the floor's own outline has to stay away: one indicator, not two.
    expect(inset, "the inset indicator must opt out of the app-wide floor").toContain(
      "outline-none"
    );

    const css = (
      await postcss([
        tailwindcss({
          ...tailwindConfig,
          content: [{ raw: `<div class="${inset}"></div>`, extension: "html" }],
        }),
      ]).process("@tailwind utilities;", { from: undefined })
    ).css;
    const block = (needle: string) =>
      css
        .split("}")
        .map((part) => part + "}")
        .find((part) => part.includes(needle));

    const style = block(".focus-visible\\:outline:focus-visible");
    expect(style, "`focus-visible:outline` must exist").toBeDefined();
    expect(style).toContain("outline-style: solid");

    const width = block(".focus-visible\\:outline-\\[3px\\]");
    expect(width, "`focus-visible:outline-[3px]` must exist").toBeDefined();
    expect(width).toContain("outline-width: 3px");

    const offset = block(".focus-visible\\:outline-offset-\\[-3px\\]");
    expect(offset, "`focus-visible:outline-offset-[-3px]` must exist").toBeDefined();
    expect(offset).toContain("outline-offset: -3px");

    const colour = block(".focus-visible\\:outline-ring:focus-visible");
    expect(colour, "`focus-visible:outline-ring` must exist").toBeDefined();
    expect(colour).toContain("outline-color: hsl(var(--ring))");
  });

  it("draws the indicator of a scroll region inside it", () => {
    const rule = scrollRegionRule();
    expect(
      rule,
      "src/app/globals.css must draw the focus indicator of a scroll region inside it"
    ).toBeDefined();
    const selector = rule!.selector;

    // It paints on keyboard focus only, and it leaves a control that opts
    // out of the floor alone (`:not(.outline-none)`), so no control shows
    // two indicators.
    expect(selector).toContain(":focus-visible");
    expect(selector).toContain(":not(.outline-none)");

    // It has to win over the app-wide floor, which paints the same outline
    // outside the control.
    const floor = focusFloorRule();
    expect(floor, "the app-wide focus floor must exist").toBeDefined();
    expect(
      specificity(selector),
      "the scroll-region rule must outrank the app-wide floor"
    ).toBeGreaterThan(specificity(floor!.selector));

    // Every scroll utility used in src/ has to be named by the rule, or a
    // region that uses it keeps the clipped indicator.
    const covered = new Set<string>();
    for (const part of selector.split(",")) {
      for (const match of part.matchAll(/\.(overflow(?:-[xy])?-(?:auto|scroll))\b/g)) {
        covered.add(match[1]);
      }
    }
    const uncovered = [...usedScrollUtilities()].filter((name) => !covered.has(name));
    expect(
      uncovered,
      `These scroll utilities are used in src/ but the app-wide scroll-region rule does not name them:\n${uncovered
        .map((name) => `  ${name}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("draws the indicator of a scroll region that opts out of the app-wide rule inside", () => {
    const offenders = elementsWithClasses().filter((element) => {
      const names = effectiveNames(element);
      if (!names.some(isScrollUtility)) return false;
      // The app-wide rule does not match a control that carries
      // `outline-none`, so such a region has to draw its own indicator.
      if (!names.includes("outline-none")) return false;
      return !element.shared.includes(INSET_SHARED_NAME);
    });
    expect(
      offenders,
      `These scroll regions opt out of the app-wide rule and do not draw their indicator inside:\n${offenders
        .map(
          (offender) =>
            `  ${offender.file}:${offender.line} <${offender.tag}> ${offender.names.join(" ")}`
        )
        .join("\n")}`
    ).toEqual([]);
  });

  it("keeps a control that draws the inset indicator to a single indicator", () => {
    const offenders = elementsWithClasses().filter((element) => {
      if (!element.shared.includes(INSET_SHARED_NAME)) return false;
      // A ring is painted outside the control, the inset outline inside it:
      // two indicators, and the one outside is the one that gets cut off.
      return focusRingWidth(effectiveNames(element)) !== null;
    });
    expect(
      offenders,
      `These elements draw the inset indicator and a focus ring at the same time:\n${offenders
        .map(
          (offender) =>
            `  ${offender.file}:${offender.line} <${offender.tag}> ${offender.names.join(" ")}`
        )
        .join("\n")}`
    ).toEqual([]);
  });
});
