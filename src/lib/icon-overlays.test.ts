import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #181 — the follow-up to #152, which PR #156 fixed on the auth pages
 * only. A decorative icon that is positioned over a form control takes the
 * pointer hit: `elementFromPoint` at the icon's centre returns the SVG, the
 * field underneath is never focused, and the tap looks like it did nothing.
 *
 * The rule this file states, for every file in `src/`:
 *
 *   an element that is taken out of the flow (`absolute` / `fixed`) and put
 *   over a form control must not take the pointer itself
 *
 * "Must not take the pointer" is Tailwind's `pointer-events-none`. It is the
 * half of the fix a browser cannot infer: lucide-react already renders
 * `aria-hidden="true"` on every icon it makes, but nothing stops the SVG from
 * being the top-most element at the icon's own coordinates.
 *
 * Two shapes are covered:
 *
 *   - an icon (a component imported from `lucide-react`) positioned over a
 *     field — the leading-icon gutter of every search box, every password
 *     field and every telephone field, and
 *   - any other out-of-flow decoration next to a field, such as the unit
 *     label of a numeric result.
 *
 * An element that is the target of a click is exempt: an icon with its own
 * `onClick`, a native `button`, an `a`. A positioned close button over a
 * dialog is a control, not a decoration.
 *
 * The check is a source check because the unit tests run in node without a
 * DOM. `e2e/auth-leading-icons.spec.ts` and the browser check in this
 * issue's pull request measure the same property in a real browser.
 */

const SRC_ROOT = join(__dirname, "..");

/** Native and kit elements that render a form control. */
const CONTROLS = new Set([
  "input",
  "select",
  "textarea",
  "Input",
  "Textarea",
  "Select",
  "Checkbox",
  "Switch",
  "RadioGroup",
  "Slider",
  "Combobox",
]);

/** Native elements that are a click target of their own. */
const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea", "option"]);

/** Tailwind utilities that take an element out of the flow. */
const OUT_OF_FLOW = new Set(["absolute", "fixed"]);

type Tag = { name: string; attrs: string; selfClosing: boolean; end: number };

type Element = {
  name: string;
  attrs: string;
  /** Offset of the element's `<` in the source. */
  start: number;
  children: Element[];
  parent: Element | null;
};

/**
 * Read one JSX tag starting at `<`. Attribute values may hold braces (an
 * inline handler contains `=>`, whose `>` must not end the tag) and quotes, so
 * both are skipped over.
 */
function readTag(src: string, start: number): Tag {
  let i = start + 1;
  const nameStart = i;
  while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) i += 1;
  const name = src.slice(nameStart, i);
  const attrsStart = i;
  let braceDepth = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      braceDepth -= 1;
      i += 1;
      continue;
    }
    if (c === ">" && braceDepth === 0) break;
    i += 1;
  }
  return {
    name,
    attrs: src.slice(attrsStart, i),
    selfClosing: src[i - 1] === "/",
    end: i + 1,
  };
}

/** Read a balanced `{...}` expression starting at `{`. */
function readExpression(src: string, start: number): { body: string; end: number } {
  let i = start + 1;
  let depth = 1;
  let quote: string | null = null;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  return { body: src.slice(start + 1, i - 1), end: i };
}

/** Find the closing tag that matches the open tag at `openIdx`. */
function findClose(src: string, openIdx: number, name: string): { index: number; length: number } | null {
  const openRe = new RegExp(`<${name}(?=[\\s/>])`, "g");
  const closeRe = new RegExp(`</${name}\\s*>`, "g");
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(src);
    const close = closeRe.exec(src);
    if (!close) return null;
    if (open && open.index < close.index) {
      const tag = readTag(src, open.index);
      if (!tag.selfClosing) depth += 1;
      i = tag.end;
      continue;
    }
    if (depth === 0) return { index: close.index, length: close[0].length };
    depth -= 1;
    if (depth === 0) return { index: close.index, length: close[0].length };
    i = close.index + close[0].length;
  }
  return null;
}

/**
 * The elements of one region of markup, as a tree. A region is the span
 * between an element's opening and closing tag, so a child never escapes its
 * parent and a sibling is a child of the same parent.
 */
function parseRegion(src: string, from: number, to: number): Element[] {
  const roots: Element[] = [];
  let i = from;
  while (i < to) {
    const lt = src.indexOf("<", i);
    if (lt === -1 || lt >= to) break;
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      i = end === -1 ? to : end + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      i = end === -1 ? to : end + 1;
      continue;
    }
    const next = src[lt + 1];
    // A closing tag here belongs to an element of an outer region.
    if (next === "/") {
      i = lt + 2;
      continue;
    }
    if (!next || !/[A-Za-z]/.test(next)) {
      i = lt + 1;
      continue;
    }
    const tag = readTag(src, lt);
    const element: Element = { name: tag.name, attrs: tag.attrs, start: lt, children: [], parent: null };
    roots.push(element);
    if (tag.selfClosing) {
      i = tag.end;
      continue;
    }
    const close = findClose(src, lt, tag.name);
    const regionEnd = close ? close.index : to;
    element.children = parseRegion(src, tag.end, regionEnd);
    for (const child of element.children) child.parent = element;
    i = close ? close.index + close.length : regionEnd;
  }
  return roots;
}

/**
 * The class list of an element. A literal is used as it is; an expression
 * (`cn("a", open && "b")`) contributes every string it mentions, which
 * over-approximates the classes that are really applied.
 */
function classNameOf(attrs: string): string[] {
  const literal = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (literal) return (literal[1] ?? literal[2] ?? "").split(/\s+/).filter(Boolean);
  const at = attrs.search(/className\s*=\s*\{/);
  if (at === -1) return [];
  const { body } = readExpression(attrs, attrs.indexOf("{", at));
  return (body.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [])
    .map((value) => value.slice(1, -1))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The local names a file imports from `lucide-react`: the icons it uses. */
export function lucideIconNames(source: string): Set<string> {
  const names = new Set<string>();
  const imports = /import\s+([^;]*?)\s+from\s+["']lucide-react["']/g;
  let match: RegExpExecArray | null;
  while ((match = imports.exec(source)) !== null) {
    const braces = match[1].match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const part of braces[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

/** Does the element carry a click handler of its own? */
function hasClickHandler(attrs: string): boolean {
  return /\son(click|pointerdown|mousedown|keydown|keyup)\s*=/.test(attrs);
}

/** A printable name for a control: its tag and the id or name it carries. */
function describeControl(element: Element): string {
  const id = element.attrs.match(/\b(id|name)\s*=\s*"([^"]*)"/);
  return id ? `<${element.name} ${id[1]}="${id[2]}">` : `<${element.name}>`;
}

/** The form control this element sits next to, if any. */
function controlSibling(element: Element): Element | null {
  const siblings = element.parent?.children ?? [];
  return siblings.find((sibling) => sibling !== element && CONTROLS.has(sibling.name)) ?? null;
}

export type Overlay = {
  line: number;
  name: string;
  className: string;
  /** The control the overlay sits on, when there is one. */
  control: string | null;
};

/**
 * Every out-of-flow element in `source` that is put over a form control
 * without declaring `pointer-events-none`.
 */
export function overlaysWithoutPointerEventsNone(source: string): Overlay[] {
  const icons = lucideIconNames(source);
  const offenders: Overlay[] = [];

  const visit = (element: Element) => {
    const classes = classNameOf(element.attrs);
    const outOfFlow = classes.some((value) => OUT_OF_FLOW.has(value));
    const inert = classes.includes("pointer-events-none");
    if (outOfFlow && !inert) {
      const control = controlSibling(element);
      // An icon is a decoration wherever it is put, and it never needs the
      // pointer. A click handler makes it a target of its own instead.
      const isIcon = icons.has(element.name) && !hasClickHandler(element.attrs);
      // Any other out-of-flow element is only a decoration when it is not
      // interactive itself; it is reported when it covers a control.
      const isDecoration =
        !isIcon &&
        control !== null &&
        !INTERACTIVE.has(element.name) &&
        !hasClickHandler(element.attrs) &&
        !/^[A-Z]/.test(element.name);
      if (isIcon || isDecoration) {
        offenders.push({
          line: source.slice(0, element.start).split("\n").length,
          name: element.name,
          className: classes.join(" "),
          control: control ? describeControl(control) : null,
        });
      }
    }
    for (const child of element.children) visit(child);
  };

  for (const root of parseRegion(source, 0, source.length)) visit(root);
  return offenders;
}

/** Every .tsx file under `src/`. */
function tsxFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...tsxFiles(path));
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("icons and decorations over a form control (issue #181)", () => {
  it("catches an absolutely positioned icon over a field", () => {
    const source = [
      'import { Search } from "lucide-react";',
      '<div className="relative">',
      '  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />',
      '  <Input placeholder="Search" />',
      "</div>",
    ].join("\n");
    const offenders = overlaysWithoutPointerEventsNone(source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].name).toBe("Search");
    expect(offenders[0].control).toBe("<Input>");
  });

  it("accepts the same icon once it is inert to the pointer", () => {
    const source = [
      'import { Search } from "lucide-react";',
      '<div className="relative">',
      '  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4" />',
      '  <Input placeholder="Search" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("catches an icon that is fixed rather than absolute", () => {
    const source = [
      'import { Search } from "lucide-react";',
      '<div>',
      '  <Search className="fixed right-4 top-4 h-4 w-4" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toHaveLength(1);
  });

  it("catches an icon whose class is written over several lines", () => {
    const source = [
      'import { Search } from "lucide-react";',
      "<div className=\"relative\">",
      "  <Search",
      '    className="absolute left-3 top-2.5 h-4 w-4"',
      "  />",
      '  <Input placeholder="Search" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toHaveLength(1);
  });

  it("catches an icon rendered from a conditional expression", () => {
    const source = [
      'import { Search } from "lucide-react";',
      "<div className=\"relative\">",
      "  {open && <Search className=\"absolute left-3 top-2.5 h-4 w-4\" />}",
      '  <Input placeholder="Search" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toHaveLength(1);
  });

  it("catches a decoration that is not an icon but still covers the field", () => {
    const source = [
      '<div className="relative">',
      '  <span className="absolute right-4 top-3 text-xs">mg</span>',
      '  <input type="number" />',
      "</div>",
    ].join("\n");
    const offenders = overlaysWithoutPointerEventsNone(source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].control).toBe("<input>");
  });

  it("leaves a positioned control of its own alone", () => {
    // A clear button over a field is a control, not a decoration: it has to
    // receive the tap.
    const source = [
      '<div className="relative">',
      '  <input type="text" />',
      '  <button type="button" className="absolute right-2 top-2" onClick={clear}>x</button>',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("leaves an icon that is in the flow alone", () => {
    const source = [
      'import { Search } from "lucide-react";',
      '<div className="flex items-center gap-2">',
      '  <Search className="h-4 w-4" />',
      '  <Input placeholder="Search" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("leaves no icon or decoration over a form control without pointer-events-none", () => {
    const problems = tsxFiles(SRC_ROOT).flatMap((file) =>
      overlaysWithoutPointerEventsNone(readFileSync(file, "utf8")).map((offender) => ({
        file: file.slice(SRC_ROOT.length + 1),
        ...offender,
      })),
    );

    expect(
      problems.map(
        (problem) =>
          `${problem.file}:${problem.line} <${problem.name}> "${problem.className}"` +
          (problem.control ? ` over ${problem.control}` : "") +
          " — an overlay that covers a control must declare pointer-events-none",
      ),
      "an out-of-flow decoration over a form control takes the tap; add pointer-events-none",
    ).toEqual([]);
  });
});
