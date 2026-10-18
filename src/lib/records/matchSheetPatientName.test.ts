import { describe, expect, it } from "vitest";
import { type PatientNameParts, matchSheetPatientName, nameTokens } from "./matchSheetPatientName";

/**
 * Issue #60: OCR autofill applied a sheet printed for a different patient
 * without a word. These pin what counts as "the same name" -- and, more
 * importantly, what does not.
 */

const juan = { first_name: "Juan", last_name: "Dela Cruz" };
const kind = (sheetName: string | null | undefined, patient: PatientNameParts = juan) =>
  matchSheetPatientName(sheetName, patient).kind;

describe("matchSheetPatientName", () => {
  it("matches the exact name", () => {
    expect(kind("Juan Dela Cruz")).toBe("match");
  });

  it("ignores case, extra whitespace and punctuation", () => {
    expect(kind("  JUAN   dela-cruz. ")).toBe("match");
    expect(kind("juan DELA CRUZ")).toBe("match");
  });

  it("accepts LAST, FIRST ordering when the sheet marks it with a comma", () => {
    expect(kind("DELA CRUZ, JUAN")).toBe("match");
    expect(kind("Dela Cruz, Juan M.")).toBe("match");
  });

  it("folds diacritics on either side", () => {
    expect(kind("José Peña", { first_name: "Jose", last_name: "Pena" })).toBe("match");
    expect(kind("JOSE PENA", { first_name: "José", last_name: "Peña" })).toBe("match");
  });

  it("allows a middle name or initial missing on one side", () => {
    expect(kind("Juan M. Dela Cruz")).toBe("match");
    expect(kind("Juan Miguel Dela Cruz")).toBe("match");
    expect(kind("Juan Dela Cruz", { first_name: "Juan Miguel", last_name: "Dela Cruz" })).toBe("match");
  });

  it("lets a middle initial stand for the full middle name, but not a different one", () => {
    const record = { first_name: "Juan Miguel", last_name: "Dela Cruz" };
    expect(kind("Juan M Dela Cruz", record)).toBe("match");
    expect(kind("Juan R. Dela Cruz", record)).toBe("mismatch");
    expect(kind("Juan Rafael Dela Cruz", record)).toBe("mismatch");
  });

  it("refuses a different first name with the same surname", () => {
    expect(kind("Pedro Dela Cruz")).toBe("mismatch");
  });

  it("refuses a sibling who shares the surname and the middle initial", () => {
    expect(kind("Juana M. Dela Cruz")).toBe("mismatch");
    expect(kind("DELA CRUZ, MARIA")).toBe("mismatch");
  });

  it("refuses the same first name with a different surname", () => {
    expect(kind("Juan Santos")).toBe("mismatch");
    expect(kind("Juan Cruz")).toBe("mismatch");
    expect(kind("Juan Dela Cruz Santos")).toBe("mismatch");
  });

  it("refuses a first initial in place of the first name", () => {
    expect(kind("J. Dela Cruz")).toBe("mismatch");
  });

  it("refuses comma-less reversed order, which is ambiguous", () => {
    expect(kind("Dela Cruz Juan")).toBe("mismatch");
  });

  it("refuses a surname-only or given-name-only sheet", () => {
    expect(kind("Dela Cruz")).toBe("mismatch");
    expect(kind("Juan")).toBe("mismatch");
    expect(kind("DELA CRUZ,")).toBe("mismatch");
  });

  it("refuses a suffix the record does not carry", () => {
    expect(kind("Juan Dela Cruz Jr.")).toBe("mismatch");
  });

  it.each([null, undefined, "", "   ", "--", "?."])(
    "reports %j as unconfirmed rather than as a match or a mismatch",
    (sheetName) => {
      expect(kind(sheetName)).toBe("unconfirmed");
    }
  );

  it("reports unconfirmed when the open patient has no usable name", () => {
    expect(kind("Juan Dela Cruz", { first_name: "", last_name: "Dela Cruz" })).toBe("unconfirmed");
    expect(kind("Juan Dela Cruz", { first_name: "Juan", last_name: null })).toBe("unconfirmed");
  });
});

describe("nameTokens", () => {
  it("joins apostrophes and splits on other punctuation", () => {
    expect(nameTokens("O'Neil-Smith, Ma. Ángela")).toEqual(["oneil", "smith", "ma", "angela"]);
  });
});
