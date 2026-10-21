import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Issue #190: the two native date controls in the filter card of
 * `/specialist/patients` overflowed their grid column, and the card's
 * `overflow-hidden` cut the end date field - and the right side of its focus
 * ring - off.
 *
 * A native date control refuses to be narrower than 165px: that is
 * Chrome's min-content width for the control with this page's font and
 * padding, measured in the browser. Two of them side by side therefore need
 * 338px, which the four column slot of the twelve column grid cannot give
 * them at any width the page is used at.
 *
 * The layout therefore has to hold three properties, and this guard states
 * them at the source level, because the unit tests run in node without a DOM:
 *
 *   1. every date control sits in a field that is at least 165px wide, so
 *      the date text and the picker button can never collide,
 *   2. the range block wraps, so the two fields stack instead of overflowing
 *      the card when the slot is too narrow,
 *   3. the range block takes a full row of the grid below `lg`, because at
 *      768px a four column slot of the twelve column grid is 127px wide -
 *      narrower than a single date control.
 *
 * The measurements that back the 165px and the 127px are in the issue's
 * browser evidence: the width of the control, of the slot and of the card at
 * 375px, 768px, 1024px and 1280px.
 */

const COMPONENT = join(__dirname, "SpecialistPatientsClient.tsx");

/**
 * The width a native date control needs, in px. Chrome's min-content width
 * for `input[type=date]` with this page's font size and padding.
 */
const NATIVE_DATE_MIN_WIDTH = 165;

/** The root font size a `rem` length is measured against. */
const ROOT_FONT_SIZE = 16;

/** A class list of a JSX element, or an empty list when it declares none. */
function classNamesOf(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
): string[] {
  const attribute = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(source) === "className",
  );
  if (!attribute || !attribute.initializer) return [];
  if (!ts.isStringLiteral(attribute.initializer)) return [];
  return attribute.initializer.text.split(/\s+/).filter(Boolean);
}

/** The px width a `min-w-` token asks for, or null when it is not a length. */
function minWidthPx(token: string): number | null {
  const match = /^min-w-\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE : value;
}

type DateControl = {
  /** The class list of the field the control sits in. */
  fieldClasses: string[];
  /** The class list of the range block the field sits in. */
  blockClasses: string[];
  line: number;
};

/**
 * The raw `<input type="date">` controls of the filter card, with the field
 * and the range block they sit in.
 *
 * The page's own `<Input type="date">` in the add-patient dialog is not a raw
 * input and is not part of the filter card, so it is not collected here.
 */
function dateControls(): DateControl[] {
  const source = ts.createSourceFile(
    COMPONENT,
    readFileSync(COMPONENT, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: DateControl[] = [];
  /** The JSX elements currently open, outermost first. */
  const open: ts.JsxOpeningElement[] = [];

  /** Collects a date control, with the field and the block it sits in. */
  const collect = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): void => {
    const isDateInput =
      node.tagName.getText(source) === "input" &&
      node.attributes.properties.some(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(source) === "type" &&
          property.initializer !== undefined &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === "date",
      );
    if (!isDateInput) return;
    const field = open[open.length - 1];
    const block = open[open.length - 2];
    if (!field || !block) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({
      fieldClasses: classNamesOf(field, source),
      blockClasses: classNamesOf(block, source),
      line: line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      collect(node.openingElement);
      open.push(node.openingElement);
      for (const child of node.children) visit(child);
      open.pop();
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      collect(node);
      return;
    }
    if (ts.isJsxOpeningElement(node)) {
      collect(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the specialist patients date filters", () => {
  const controls = dateControls();

  it("has a start and an end date in the filter card", () => {
    expect(controls.length, "the filter card has a start and an end date").toBe(2);
  });

  it("keeps every date control in a field that is at least as wide as the control needs", () => {
    for (const control of controls) {
      const widths = control.fieldClasses
        .map(minWidthPx)
        .filter((width): width is number => width !== null);
      expect(
        widths,
        `the date control on line ${control.line} needs a field of at least ${NATIVE_DATE_MIN_WIDTH}px, ` +
          "or the date text and the picker button collide",
      ).not.toEqual([]);
      expect(
        Math.max(...widths),
        `the date control on line ${control.line} needs a field of at least ${NATIVE_DATE_MIN_WIDTH}px`,
      ).toBeGreaterThanOrEqual(NATIVE_DATE_MIN_WIDTH);
    }
  });

  it("wraps the date range so the two fields stack instead of overflowing the card", () => {
    for (const control of controls) {
      expect(
        control.blockClasses,
        `the date range block above line ${control.line} must wrap`,
      ).toContain("flex-wrap");
    }
  });

  it("gives the date range a full row of the grid below lg", () => {
    for (const control of controls) {
      expect(
        control.blockClasses,
        `the date range block above line ${control.line} must take a full row at the md breakpoint, ` +
          "where a four column slot is narrower than one date control",
      ).toContain("md:col-span-12");
    }
  });
});
