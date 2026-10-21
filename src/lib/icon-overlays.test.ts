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
 * A control counts as covered when it is a sibling of the overlay, or sits
 * under a wrapper chain next to it (`FormField` > `FormItem` >
 * `FormControl` > the control). What the overlay does not cover is what
 * paints above it: a sibling that is positioned and comes later in the
 * source, and an overlay with a negative z-index.
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

/**
 * Does the element carry a click handler of its own? JSX spells handlers in
 * camelCase (`onClick`), so the match is case-insensitive.
 */
function hasClickHandler(attrs: string): boolean {
  return /\son(click|dblclick|pointerdown|mousedown|keydown|keyup)\s*=/i.test(attrs);
}

/** A printable name for a control: its tag and the id or name it carries. */
function describeControl(element: Element): string {
  const id = element.attrs.match(/\b(id|name)\s*=\s*"([^"]*)"/);
  return id ? `<${element.name} ${id[1]}="${id[2]}">` : `<${element.name}>`;
}

/**
 * The first control in this element's subtree, if there is one.
 *
 * The search stops after three levels. A decoration that is a sibling of a
 * control, or of a wrapper chain around one (`FormField` > `FormItem` >
 * `FormControl` > the control), is over that control; a decoration that is a
 * sibling of a whole page block — a card that holds a form several levels
 * down — is not.
 */
function findControl(element: Element, depth = 3): Element | null {
  if (CONTROLS.has(element.name)) return element;
  if (depth === 0) return null;
  for (const child of element.children) {
    const found = findControl(child, depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Is the element positioned — either out of the flow or the positioning
 * context of its children?
 */
function isPositioned(element: Element): boolean {
  return classNameOf(element.attrs).some((value) =>
    ["relative", "absolute", "fixed", "sticky"].includes(value),
  );
}

/**
 * The form control this element covers, if any.
 *
 * The control is often not a direct sibling: it may sit inside a wrapper
 * (`FormControl`, a styled `label`), so the sibling's subtree is searched.
 *
 * What the search leaves out is what paints *above* the overlay: a sibling
 * that is positioned and comes later in the source is painted over it, so
 * the overlay is behind that sibling and covers nothing of it. An overlay
 * with a negative z-index is behind everything in its context, so it covers
 * nothing either.
 */
function coveredControl(element: Element): Element | null {
  const siblings = element.parent?.children ?? [];
  if (classNameOf(element.attrs).some((value) => value.startsWith("-z-"))) return null;

  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    if (sibling === element) continue;
    // A positioned sibling that comes later in the source paints above the
    // overlay, so the overlay is behind it.
    if (isPositioned(sibling) && index > siblings.indexOf(element)) continue;
    const found = findControl(sibling);
    if (found) return found;
  }
  return null;
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
      const control = coveredControl(element);
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

  it("catches a decoration whose control is nested in a wrapper chain", () => {
    // The form kit wraps a control in three elements. The overlay is still
    // the sibling of that chain, and it still takes the tap.
    const source = [
      '<div className="relative">',
      '  <div className="absolute inset-y-0 left-3 flex items-center">',
      '    <span className="h-4 w-4" />',
      "  </div>",
      "  <FormField>",
      "    <FormItem>",
      "      <FormControl>",
      '        <Input placeholder="Search" />',
      "      </FormControl>",
      "    </FormItem>",
      "  </FormField>",
      "</div>",
    ].join("\n");
    const offenders = overlaysWithoutPointerEventsNone(source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].control).toBe("<Input>");
  });

  it("catches a decoration that covers the control of a section", () => {
    // The section is not positioned, so the absolute background paints above
    // it and intercepts the tap on the input inside.
    const source = [
      '<div className="relative">',
      '  <div className="absolute inset-0 bg-slate-100" />',
      "  <section>",
      "    <div>",
      "      <div>",
      '        <input type="text" />',
      "      </div>",
      "    </div>",
      "  </section>",
      "</div>",
    ].join("\n");
    const offenders = overlaysWithoutPointerEventsNone(source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].control).toBe("<input>");
  });

  it("leaves a decoration behind a positioned section alone", () => {
    // The section is positioned and comes later in the source, so it paints
    // above the background and the background covers nothing of it.
    const source = [
      '<div className="relative">',
      '  <div className="absolute inset-0 bg-slate-100" />',
      '  <section className="relative">',
      "    <div>",
      "      <div>",
      '        <input type="text" />',
      "      </div>",
      "    </div>",
      "  </section>",
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("leaves a decoration behind a negative z-index alone", () => {
    const source = [
      '<div className="relative">',
      '  <div className="absolute inset-0 -z-10 bg-slate-100" />',
      '  <input type="text" />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
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

  it("leaves an icon with its own click handler alone", () => {
    // A password-visibility toggle is the target of the tap, so it must keep
    // the pointer even though it is an icon.
    const source = [
      'import { Eye } from "lucide-react";',
      '<div className="relative">',
      '  <input type="password" />',
      '  <Eye className="absolute right-3 top-2.5 h-4 w-4" onClick={toggle} />',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("leaves a decoration with its own click handler alone", () => {
    const source = [
      '<div className="relative">',
      '  <input type="text" />',
      '  <div className="absolute right-2 top-2" onClick={clear}>x</div>',
      "</div>",
    ].join("\n");
    expect(overlaysWithoutPointerEventsNone(source)).toEqual([]);
  });

  it("catches a decoration whose control is nested deeper", () => {
    // The control is not a direct sibling: it sits inside a wrapper, and only
    // the icon wrapper is positioned. The overlay still takes the tap.
    const source = [
      '<div className="relative">',
      '  <div className="absolute inset-y-0 left-3 flex items-center">',
      '    <span className="h-4 w-4" />',
      "  </div>",
      "  <FormControl>",
      '    <Input placeholder="Search" />',
      "  </FormControl>",
      "</div>",
    ].join("\n");
    const offenders = overlaysWithoutPointerEventsNone(source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].control).toBe("<Input>");
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
