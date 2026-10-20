import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #157: the "Refresh Data" button on /patient/submissions hid its only
 * text below the `sm` breakpoint, so on a phone the control had no accessible
 * name at all (WCAG 4.1.2). The same shape is easy to reintroduce, so this
 * guard states the rule for every button and link in src/:
 *
 *   a control must have a name at every width at which it is rendered
 *
 * A name is either an explicit `aria-label` / `aria-labelledby` / `title`, or
 * text that is rendered wherever the control is. Text that a responsive
 * utility (`hidden`, `hidden sm:inline`, `md:hidden`, ...) removes at some
 * width cannot carry the name there. Text inside an `aria-hidden` subtree is
 * not part of the name at all.
 *
 * This is a source-level check because the repo's unit tests run in node
 * without a DOM. It is deliberately conservative: a name it cannot prove is
 * missing is reported, and text that comes from a JavaScript expression is
 * accepted, because the expression may resolve to a string.
 */

const SRC_ROOT = join(__dirname, "..");

const INTERACTIVE = new Set(["button", "Button", "a", "Link"]);

/** Tailwind's responsive breakpoints, as the widths the guard reasons about. */
const BREAKPOINTS = ["sm", "md", "lg", "xl", "2xl"];
/** Index of the first width band, and the one past the last breakpoint. */
const FIRST = 0;
const LAST = BREAKPOINTS.length + 1;

/** Utilities that put an element back into the rendering tree. */
const DISPLAY_UTILITIES = new Set([
  "block",
  "inline",
  "inline-block",
  "inline-flex",
  "flex",
  "grid",
  "table",
  "table-row",
  "table-cell",
  "contents",
  "list-item",
  "flow-root",
]);

/**
 * The widths at which an element is rendered, as a half-open band of
 * breakpoint indices. A bare `hidden` with no display override is never
 * rendered; `hidden md:inline-flex` is rendered from `md` up; `md:hidden` is
 * rendered below `md`.
 */
function visibilityOf(className: string): { from: number; until: number } {
  let from = FIRST;
  let until = LAST;
  let overrideFrom = LAST;
  let bareHidden = false;
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(":");
    if (separator === -1) {
      if (token === "hidden") bareHidden = true;
      continue;
    }
    const prefix = token.slice(0, separator);
    const utility = token.slice(separator + 1);
    if (prefix === "print") continue;
    if (prefix.startsWith("max-")) {
      // max-sm:hidden hides below sm, so the element appears from sm up.
      const index = BREAKPOINTS.indexOf(prefix.slice(4));
      if (index !== -1 && utility === "hidden") from = Math.max(from, index + 1);
      continue;
    }
    const index = BREAKPOINTS.indexOf(prefix);
    if (index === -1) continue;
    const band = index + 1;
    if (utility === "hidden") until = Math.min(until, band);
    else if (DISPLAY_UTILITIES.has(utility)) overrideFrom = Math.min(overrideFrom, band);
  }
  // A bare `hidden` removes the element at every width, until a display
  // utility puts it back.
  if (bareHidden) from = Math.max(from, overrideFrom);
  return { from, until };
}

type Element = {
  name: string;
  attrs: string;
  /** Offset in the original source. */
  start: number;
  /** First width band at which the element is rendered. */
  from: number;
  /** First width band at which it is no longer rendered. */
  until: number;
  /** Inside an aria-hidden subtree. */
  ariaHidden: boolean;
};

type TextNode = { text: string; path: Element[] };

type Tag = {
  name: string;
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
};

/**
 * Read one JSX tag starting at `<`. Attribute values may hold braces (an
 * inline handler contains `=>`, whose `>` must not end the tag) and quotes, so
 * both are skipped over.
 */
function readTag(src: string, start: number): Tag {
  let i = start + 1;
  let closing = false;
  if (src[i] === "/") {
    closing = true;
    i += 1;
  }
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
    closing,
    selfClosing: src[i - 1] === "/",
    end: i + 1,
  };
}

/** Read a balanced `{...}` expression starting at `{`. */
function readExpression(src: string, start: number): { body: string; bodyStart: number; end: number } {
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
  return { body: src.slice(start + 1, i - 1), bodyStart: start + 1, end: i };
}

/** Remove every JSX element from an expression, leaving the JavaScript. */
function stripJsx(body: string): string {
  let out = body;
  let guard = 0;
  while (guard++ < 200) {
    const lt = out.indexOf("<");
    if (lt === -1) break;
    const next = out[lt + 1];
    if (next !== "/" && (!next || !/[A-Za-z]/.test(next))) {
      out = out.slice(0, lt) + " " + out.slice(lt + 1);
      continue;
    }
    const tag = readTag(out, lt);
    out = out.slice(0, lt) + " " + out.slice(tag.end);
  }
  return out;
}

/**
 * Split `test ? consequent : alternate` at the top level. Returns null when the
 * expression is not a ternary.
 */
function splitTernary(source: string): { consequent: string; alternate: string } | null {
  let depth = 0;
  let quote: string | null = null;
  let question = -1;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "?" && depth === 0) {
      // `?.` is optional chaining and `??` is nullish coalescing.
      if (source[i + 1] === "." || source[i + 1] === "?") continue;
      question = i;
      break;
    }
  }
  if (question === -1) return null;
  depth = 0;
  quote = null;
  for (let i = question + 1; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === ":" && depth === 0) {
      return { consequent: source.slice(question + 1, i), alternate: source.slice(i + 1) };
    }
  }
  return null;
}

/** Does this JavaScript value produce a string? */
function valueProducesText(source: string): boolean {
  if (/"[^"]*"|'[^']*'/.test(source)) return true;
  const notText = new Set(["className", "class", "true", "false", "null", "undefined", "typeof", "new", "await", "void"]);
  return (source.match(/[A-Za-z_$][\w$]*/g) ?? []).some((word) => !notText.has(word));
}

/**
 * `cond && value` renders `value` or nothing, so only the last operand can be
 * text; the condition is a condition, not a value.
 */
function branchProducesText(source: string): boolean {
  const parts = source.split("&&");
  return valueProducesText(parts[parts.length - 1]);
}

/**
 * Does this expression produce text? A string literal does, and so does a
 * plain identifier, because it may hold a string at runtime (`{item.label}`).
 * An expression that only picks between elements
 * (`{isRefreshing ? <Loader2 /> : <RefreshCw />}`) does not: the condition of
 * a ternary is a condition, not a value.
 */
function expressionProducesText(body: string): boolean {
  const stripped = stripJsx(body);
  const ternary = splitTernary(stripped);
  if (!ternary) return branchProducesText(stripped);
  return branchProducesText(ternary.consequent) || branchProducesText(ternary.alternate);
}

function classNameOf(attrs: string): string {
  const literal = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (literal) return literal[1] ?? literal[2] ?? "";
  const at = attrs.search(/className\s*=\s*\{/);
  if (at === -1) return "";
  const { body } = readExpression(attrs, attrs.indexOf("{", at));
  // cn("a", cond && "b"), clsx(...), `a ${b}`: every literal may apply.
  return (body.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? []).map((s) => s.slice(1, -1)).join(" ");
}

function altOf(attrs: string): string | null {
  const match = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function isAriaHidden(attrs: string): boolean {
  return /(^|\s)aria-hidden(\s*=\s*("true"|'true'|{true}))?(\s|$)/.test(attrs);
}

type Context = {
  source: string;
  elements: Element[];
  texts: TextNode[];
  stack: Element[];
};

/**
 * Walk a region of JSX content: literal text, `{expressions}` and tags.
 * `region` may be a slice of the source (an expression body) rather than the
 * source itself, so `base` maps a position in the region back to the source.
 *
 * `inExpression` marks a region that holds JavaScript rather than markup:
 * the words between the elements there are code, not rendered text.
 */
function scanRegion(ctx: Context, region: string, from: number, to: number, base: number, inExpression = false): void {
  const pushText = (text: string) => {
    if (inExpression) return;
    if (!text.trim()) return;
    ctx.texts.push({ text: text.trim(), path: [...ctx.stack] });
  };

  let i = from;
  while (i < to) {
    const lt = region.indexOf("<", i);
    const brace = region.indexOf("{", i);
    const special = lt === -1 ? brace : brace === -1 ? lt : Math.min(lt, brace);
    if (special === -1 || special >= to) {
      pushText(region.slice(i, to));
      break;
    }
    pushText(region.slice(i, special));
    i = special;

    if (region[i] === "{") {
      const expression = readExpression(region, i);
      if (expressionProducesText(expression.body)) {
        ctx.texts.push({ text: "expression", path: [...ctx.stack] });
      }
      // JSX nested inside the expression is real markup: scan it as such.
      scanRegion(ctx, expression.body, 0, expression.body.length, base + expression.bodyStart, true);
      i = expression.end;
      continue;
    }

    if (region.startsWith("<!--", i)) {
      const end = region.indexOf("-->", i);
      i = end === -1 ? to : end + 3;
      continue;
    }

    const next = region[i + 1];
    if (next === "/") {
      const tag = readTag(region, i);
      for (let k = ctx.stack.length - 1; k >= 0; k -= 1) {
        if (ctx.stack[k].name === tag.name) {
          ctx.stack.length = k;
          break;
        }
      }
      i = tag.end;
      continue;
    }
    if (!next || !/[A-Za-z]/.test(next)) {
      i += 1;
      continue;
    }

    const tag = readTag(region, i);
    if (tag.selfClosing) {
      const alt = altOf(tag.attrs);
      if (alt !== null) pushText(alt);
      // A self-closing control is a component wrapper: its name comes from
      // the caller, so there is nothing to prove here.
      i = tag.end;
      continue;
    }

    const parent = ctx.stack[ctx.stack.length - 1];
    const own = visibilityOf(classNameOf(tag.attrs));
    const element: Element = {
      name: tag.name,
      attrs: tag.attrs,
      start: base + i,
      from: Math.max(own.from, parent ? parent.from : FIRST),
      until: Math.min(own.until, parent ? parent.until : LAST),
      ariaHidden: isAriaHidden(tag.attrs) || (parent ? parent.ariaHidden : false),
    };
    ctx.elements.push(element);
    ctx.stack.push(element);
    const close = findClose(region, i, tag.name);
    if (close) {
      scanRegion(ctx, region, tag.end, close.index, base);
      // The closing tag is consumed here, so this element leaves the stack.
      ctx.stack.pop();
      i = close.index + close.length;
    } else {
      ctx.stack.pop();
      i = tag.end;
    }
  }
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

/** Every button and link in `src` that cannot be named at every width. */
export function unnamedControls(src: string): Array<{ line: number; name: string; snippet: string }> {
  const ctx: Context = { source: src, elements: [], texts: [], stack: [] };
  scanRegion(ctx, src, 0, src.length, 0);

  const lineAt = (index: number) => src.slice(0, index).split("\n").length;
  const problems: Array<{ line: number; name: string; snippet: string }> = [];

  for (const element of ctx.elements) {
    if (!INTERACTIVE.has(element.name)) continue;
    // A control that is never rendered is absent, not unnamed. So is one that
    // is hidden from assistive technology.
    if (element.from >= element.until) continue;
    if (element.ariaHidden) continue;
    const hasName = /\baria-label(ledby)?\s*=/.test(element.attrs) || /\btitle\s*=/.test(element.attrs);
    if (hasName) continue;

    // The widths at which the control carries a name: the union of the bands
    // its text is rendered in. The control must be named at every width at
    // which it is itself rendered.
    const bands: Array<[number, number]> = [];
    for (const node of ctx.texts) {
      const at = node.path.indexOf(element);
      if (at === -1) continue;
      // Text under an aria-hidden element is not part of the name.
      if (node.path.slice(at).some((el) => el.ariaHidden)) continue;
      const host = node.path[node.path.length - 1];
      if (!host || host.from >= host.until) continue;
      bands.push([host.from, host.until]);
    }
    bands.sort((first, second) => first[0] - second[0]);

    let covered = element.from;
    for (const [from, until] of bands) {
      if (until <= covered) continue;
      if (from > covered) break;
      covered = until;
    }
    if (covered >= element.until) continue;

    problems.push({
      line: lineAt(element.start),
      name: element.name,
      snippet: src.slice(element.start, element.start + 160).replace(/\s+/g, " "),
    });
  }

  return problems;
}

function collectTsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectTsxFiles(path));
    } else if (path.endsWith(".tsx") || path.endsWith(".jsx")) {
      found.push(path);
    }
  }
  return found;
}

describe("accessible names for buttons and links", () => {
  it("catches a label that only exists above a breakpoint", () => {
    const source = [
      "<Button variant=\"outline\">",
      "  {isRefreshing ? <Loader2 /> : <RefreshCw />}",
      "  <span className=\"ml-2 hidden sm:inline\">Refresh Data</span>",
      "</Button>",
    ].join("\n");
    const problems = unnamedControls(source);
    expect(problems).toHaveLength(1);
    expect(problems[0].name).toBe("Button");
  });

  it("accepts the same control once the name is explicit", () => {
    const source = [
      "<Button variant=\"outline\" aria-label=\"Refresh Data\">",
      "  {isRefreshing ? <Loader2 /> : <RefreshCw />}",
      "  <span className=\"ml-2 hidden sm:inline\">Refresh Data</span>",
      "</Button>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("catches an icon-only control with no name at all", () => {
    const source = ["<Button type=\"submit\" size=\"icon\">", "  <Send className=\"h-4 w-4\" />", "</Button>"].join("\n");
    expect(unnamedControls(source)).toHaveLength(1);
  });

  it("catches an icon-only control whose only spinner is conditional", () => {
    const source = [
      "<Button type=\"submit\" size=\"icon\">",
      "  {isSending && <Loader2 className=\"h-4 w-4\" />}",
      "  <Send className=\"h-4 w-4\" />",
      "</Button>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(1);
  });

  it("catches a label hidden through a cn() class expression", () => {
    const source = [
      "<Button variant=\"outline\">",
      "  <RefreshCw className=\"h-4 w-4\" />",
      "  <span className={cn(\"ml-2 hidden sm:inline\")}>Refresh Data</span>",
      "</Button>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(1);
  });

  it("catches a label hidden by a max-width variant", () => {
    const source = [
      "<Button type=\"button\">",
      "  <Trash2 className=\"h-4 w-4\" />",
      "  <span className=\"max-sm:hidden\">Delete</span>",
      "</Button>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(1);
  });

  it("accepts a control whose text is always rendered", () => {
    const source = ["<Button type=\"submit\">", "  <Save className=\"h-4 w-4\" /> Save Results", "</Button>"].join("\n");
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("accepts a control that hides itself, because it is then absent", () => {
    const source = [
      "<button type=\"button\" className=\"hidden items-center md:inline-flex\">",
      "  Recently completed",
      "</button>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("catches an icon-only control that only appears from md up", () => {
    const source = [
      "<div className=\"hidden md:flex\">",
      "  <button type=\"button\" size=\"icon\">",
      "    <Trash2 className=\"h-4 w-4\" />",
      "  </button>",
      "</div>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(1);
  });

  it("accepts a control that is hidden at every width", () => {
    const source = ["<button type=\"button\" className=\"hidden\">", "  <Trash2 className=\"h-4 w-4\" />", "</button>"].join(
      "\n"
    );
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("accepts a control named by the text of a descendant", () => {
    const source = [
      "<Link href=\"/x\">",
      "  <Card>",
      "    <CardTitle>Track Submissions</CardTitle>",
      "  </Card>",
      "</Link>",
    ].join("\n");
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("accepts a control named by a label element", () => {
    const source = ["<Link href=\"/x\">", "  <Image alt=\"KlinikAid\" />", "</Link>"].join("\n");
    expect(unnamedControls(source)).toHaveLength(0);
  });

  it("leaves no button or link in src/ without a width-independent name", () => {
    const problems = collectTsxFiles(SRC_ROOT).flatMap((file) =>
      unnamedControls(readFileSync(file, "utf8")).map((problem) => ({
        file: file.slice(SRC_ROOT.length + 1),
        ...problem,
      }))
    );
    expect(problems).toEqual([]);
  });
});
