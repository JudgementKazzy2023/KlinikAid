import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #157: the "Refresh Data" button on /patient/submissions hid its only
 * text below the `sm` breakpoint, so on a phone the control had no accessible
 * name at all (WCAG 4.1.2). The same shape is easy to reintroduce, so this
 * guard states the rule for every button and link in src/:
 *
 *   a control must have a name that does not depend on CSS hiding it
 *
 * A name is either an explicit `aria-label` / `aria-labelledby` / `title`, or
 * text that is rendered at every width. Text behind a `hidden` utility
 * (`hidden`, `hidden sm:inline`, `md:hidden`, ...) is not rendered at some
 * width, so it cannot carry the name there. Text inside an `aria-hidden`
 * subtree is not part of the name either.
 *
 * This is a source-level check because the repo's unit tests run in node
 * without a DOM. It is deliberately conservative: a name it cannot prove is
 * missing is reported, and text that comes from a JavaScript expression is
 * accepted, because the expression may resolve to a string.
 */

const SRC_ROOT = join(__dirname, "..");

const INTERACTIVE = new Set(["button", "Button", "a", "Link"]);

/** Tailwind utilities that remove an element from the rendering tree. */
function hidesAtSomeWidth(className: string): boolean {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .some(
      (token) =>
        token === "hidden" ||
        /^(sm|md|lg|xl|2xl|print):hidden$/.test(token) ||
        /^max-(sm|md|lg|xl|2xl):hidden$/.test(token)
    );
}

type Element = {
  name: string;
  attrs: string;
  /** Offset in the original source. */
  start: number;
  /** Hidden at some width, or hidden from assistive technology. */
  hidesName: boolean;
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
 * Does this expression produce text? A string literal does, and so does a
 * plain identifier, because it may hold a string at runtime (`{item.label}`).
 * An expression that only picks between elements
 * (`{isRefreshing ? <Loader2 /> : <RefreshCw />}`) does not: the condition of
 * a ternary is a condition, not a value.
 */
function expressionProducesText(body: string): boolean {
  const stripped = stripJsx(body);
  const ternary = splitTernary(stripped);
  if (!ternary) return valueProducesText(stripped);
  return valueProducesText(ternary.consequent) || valueProducesText(ternary.alternate);
}

function classNameOf(attrs: string): string {
  const match = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/);
  if (!match) return "";
  return match[1] ?? match[2] ?? match[3] ?? "";
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

    const element: Element = {
      name: tag.name,
      attrs: tag.attrs,
      start: base + i,
      hidesName:
        hidesAtSomeWidth(classNameOf(tag.attrs)) ||
        isAriaHidden(tag.attrs) ||
        ctx.stack.some((open) => open.hidesName),
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

/** Every button and link in `src` that cannot be named at every width. */
export function unnamedControls(src: string): Array<{ line: number; name: string; snippet: string }> {
  const ctx: Context = { source: src, elements: [], texts: [], stack: [] };
  scanRegion(ctx, src, 0, src.length, 0);

  const lineAt = (index: number) => src.slice(0, index).split("\n").length;
  const problems: Array<{ line: number; name: string; snippet: string }> = [];

  for (const element of ctx.elements) {
    if (!INTERACTIVE.has(element.name)) continue;
    // A control that hides itself is absent at that width, not unnamed.
    if (element.hidesName) continue;
    const hasName = /\baria-label(ledby)?\s*=/.test(element.attrs) || /\btitle\s*=/.test(element.attrs);
    if (hasName) continue;
    const visible = ctx.texts
      .filter((node) => {
        const at = node.path.indexOf(element);
        if (at === -1) return false;
        // Anything between the control and the text that hides removes it.
        return !node.path.slice(at + 1).some((el) => el.hidesName);
      })
      .map((node) => node.text)
      .join("")
      .trim();
    if (visible) continue;
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
