import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import ts from "typescript";
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

/** The shared constant's export names, so an alias import still counts. */
const SHARED_NAMES = new Set(Object.keys(focusRingModule));

/**
 * The ui kit's own variant helper. `buttonVariants()` always includes the
 * kit's 3px focus ring, so a control styled through it is compliant.
 */
const KIT_VARIANT_HELPERS = new Set(["buttonVariants"]);

const SRC_ROOT = join(__dirname, "..");

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

/** The px width a Tailwind width token stands for, or null when it is not one. */
function widthOf(token: string): number | null {
  const plain = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(token);
  if (plain) return Number(plain[1]);
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  return null;
}

/**
 * The widest focus ring or focus outline a class list declares, in px, or null
 * when it declares no focus indicator at all.
 *
 * `focus:ring-2` is 2px and does not qualify. `focus:ring-3` does — the
 * Tailwind config adds `ringWidth: { 3: "3px" }` for it (issue #149).
 * `focus:outline` on its own only sets the outline *style*; the width stays
 * the browser's 1px, so it does not qualify either.
 */
export function focusIndicatorWidth(classNames: string[]): number | null {
  let widest: number | null = null;
  for (const token of classNames) {
    const ring = /^focus(?:-visible)?:ring-(.+)$/.exec(token);
    if (ring) {
      const width = widthOf(ring[1]);
      if (width !== null) widest = Math.max(widest ?? 0, width);
      continue;
    }
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
): { names: string[]; usesShared: boolean } {
  const names: string[] = [];
  let usesShared = false;

  const initializer = attribute.initializer;
  if (!initializer) return { names, usesShared };
  if (ts.isStringLiteral(initializer)) {
    names.push(...initializer.text.split(/\s+/).filter(Boolean));
    return { names, usesShared };
  }
  if (!ts.isJsxExpression(initializer) || !initializer.expression) {
    return { names, usesShared };
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
      usesShared = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      KIT_VARIANT_HELPERS.has(node.expression.text)
    ) {
      usesShared = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer.expression);
  void source;
  return { names, usesShared };
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
        const { names, usesShared } = attribute
          ? classNamesOf(attribute, source)
          : { names: [] as string[], usesShared: false };
        const width = focusIndicatorWidth(names);
        if (!usesShared && (width === null || width < 3)) {
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

describe("focus indicator (issue #180)", () => {
  it("declares the shared focus ring as a 3px ring", async () => {
    const config = loadConfig(
      fileURLToPath(new URL("../../tailwind.config.ts", import.meta.url))
    );
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
});
