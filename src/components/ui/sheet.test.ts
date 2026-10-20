import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Issue #172: sheets are the same Base UI dialog primitive as dialogs, but
 * `SheetContent` never got the synchronous Tab wrap that #149 added to
 * `DialogContent`, so a fast Tab could slip past Base UI's rAF focus guards
 * and land on the page behind the sheet.
 *
 * The wrap itself is a DOM concern and is covered by the browser evidence for
 * the issue; the wiring (merged popup ref, chained onKeyDown) is JSX that the
 * node-environment unit suite cannot render. This test pins that wiring at
 * source level and cross-checks it against `dialog.tsx`, which the issue names
 * as the reference implementation — so the two cannot drift apart again.
 */

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

/** The source of one component function, up to the next top-level function. */
function componentSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} is missing from the source`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\nfunction /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Collapse whitespace so the assertions survive a reformat. */
function normalize(code: string): string {
  return code.replace(/\s+/g, " ").trim();
}

type Wiring = {
  hookCall: string;
  refMerge: string;
  refProp: string;
  keyHandler: string;
};

/** The four pieces that make the popup wrap Tab at its boundary. */
function wiringOf(source: string, name: string): Wiring {
  const component = normalize(componentSource(source, name));
  const pick = (pattern: RegExp) => pattern.exec(component)?.[0] ?? "";
  return {
    hookCall: pick(/const wrapTab = useDialogTabWrap\(popupRef\)/),
    refMerge: pick(/const setPopupRef = React\.useCallback\(.*?\}, \[ref\]\s*\)/),
    refProp: pick(/ref=\{setPopupRef\}/),
    keyHandler: pick(/onKeyDown=\{\(event\) => \{.*?\}\}/),
  };
}

const dialogSource = readSource("./dialog.tsx");
const sheetSource = readSource("./sheet.tsx");

const dialogWiring = wiringOf(dialogSource, "DialogContent");
const sheetWiring = wiringOf(sheetSource, "SheetContent");

describe("SheetContent tab wrap wiring (issue #172)", () => {
  it("imports the shared tab-wrap hook", () => {
    expect(sheetSource).toMatch(
      /import \{ useDialogTabWrap \} from "@\/hooks\/use-dialog-tab-wrap"/
    );
  });

  it("wires the popup ref into the hook", () => {
    expect(sheetWiring.hookCall).toBe("const wrapTab = useDialogTabWrap(popupRef)");
    expect(sheetWiring.refProp).toBe("ref={setPopupRef}");
  });

  it("merges the caller's ref with the popup ref, both ref forms", () => {
    expect(sheetWiring.refMerge).toContain("popupRef.current = node");
    expect(sheetWiring.refMerge).toContain('if (typeof ref === "function")');
    expect(sheetWiring.refMerge).toContain("ref(node)");
    expect(sheetWiring.refMerge).toContain("else if (ref)");
    expect(sheetWiring.refMerge).toContain("ref.current = node");
  });

  it("chains the caller's onKeyDown after the tab wrap", () => {
    expect(sheetWiring.keyHandler).not.toBe("");
    expect(sheetWiring.keyHandler).toContain("wrapTab(event)");
    expect(sheetWiring.keyHandler).toContain("onKeyDown?.(event)");
    expect(
      sheetWiring.keyHandler.indexOf("wrapTab(event)"),
      "the wrap must run before the caller's handler"
    ).toBeLessThan(sheetWiring.keyHandler.indexOf("onKeyDown?.(event)"));
  });

  it("wires exactly like DialogContent does", () => {
    expect(sheetWiring).toEqual(dialogWiring);
  });
});
