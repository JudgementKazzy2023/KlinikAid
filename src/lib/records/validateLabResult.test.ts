import { describe, expect, it } from "vitest";
import { ValidationError, handleRouteError } from "@/lib/api-response";
import { LAB_REFERENCE_RANGES, LAB_TEST_GROUPS } from "@/lib/constants";
import { validateLabPanel, validateLabResult } from "./validateLabResult";

/**
 * Issue #61: the only numeric rule was "looks like a number". FBS -5 and 99999
 * were stored, `1e3` answered 500, and a Hemoglobin result was accepted inside
 * a Lipid Profile. These tests pin the rules both lab write paths now share.
 */

const FBS = "Fasting Blood Sugar (FBS)";

function refusal(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("expected a ValidationError, but nothing was thrown");
}

describe("validateLabResult", () => {
  it.each(["-5", "99999", "0"])("refuses FBS %s, naming the parameter and the bound", (value) => {
    const error = refusal(() => validateLabResult(FBS, value, "male"));
    expect(error.message).toContain(FBS);
    expect(error.message).toContain("5–3000 mg/dL");
  });

  it.each(["1e3", "abc", "", "12,5", "Infinity"])("refuses non-numeric %j with a 400, not a 500", (value) => {
    refusal(() => validateLabResult(FBS, value, "male"));
  });

  it("still saves and flags a value outside the reference range but inside the plausible range", () => {
    const high = validateLabResult(FBS, "450", "male");
    expect(high.is_flagged).toBe(true);
    expect(high.test_value).toBe("450");

    const low = validateLabResult("Hemoglobin", "6.2", "female");
    expect(low.is_flagged).toBe(true);
  });

  it("does not flag a value inside the reference range", () => {
    expect(validateLabResult(FBS, "92", "female").is_flagged).toBe(false);
  });

  it("treats the plausible bounds as inclusive", () => {
    expect(validateLabResult(FBS, "5", "male").test_value).toBe("5");
    expect(validateLabResult(FBS, "3000", "male").test_value).toBe("3000");
    refusal(() => validateLabResult(FBS, "3000.1", "male"));
  });

  it("refuses the hemoglobin values from the analytics-chart repro", () => {
    refusal(() => validateLabResult("Hemoglobin", "-5", "male"));
    refusal(() => validateLabResult("Hemoglobin", "99999", "male"));
  });

  it("refuses an unknown parameter as a validation error", () => {
    refusal(() => validateLabResult("Potassium", "4", "male"));
  });

  it("keeps every reference range inside its plausible range", () => {
    for (const r of LAB_REFERENCE_RANGES) {
      expect(r.plausibleMin).toBeLessThan(r.plausibleMax);
      for (const bound of [r.maleMin, r.maleMax, r.femaleMin, r.femaleMax]) {
        expect(bound).toBeGreaterThanOrEqual(r.plausibleMin);
        expect(bound).toBeLessThanOrEqual(r.plausibleMax);
      }
    }
  });
});

describe("validateLabPanel", () => {
  it("returns validated rows for a well-formed panel", () => {
    const rows = validateLabPanel(
      "Complete Blood Count (CBC)",
      [
        { test_name: "Hemoglobin", test_value: "14" },
        { test_name: "Platelets", test_value: 600 },
      ],
      "male"
    );
    expect(rows.map((r) => [r.test_name, r.is_flagged])).toEqual([
      ["Hemoglobin", false],
      ["Platelets", true],
    ]);
  });

  it("refuses a result that does not belong to the submitted panel", () => {
    const error = refusal(() =>
      validateLabPanel("Lipid Profile", [{ test_name: "Hemoglobin", test_value: "14" }], "male")
    );
    expect(error.message).toContain("Hemoglobin is not part of Lipid Profile");
  });

  it("refuses an unknown panel", () => {
    refusal(() => validateLabPanel("Urinalysis", [{ test_name: "Hemoglobin", test_value: "14" }], "male"));
  });

  it.each([[{}], [{ toString: 1 }], [Object.create(null)], [["Lipid Profile"]], [5], [null]])(
    "refuses a non-string panel %j with a ValidationError, not a TypeError",
    (testType) => {
      const error = refusal(() => validateLabPanel(testType, [{ test_name: "Cholesterol", test_value: "180" }], "male"));
      expect(error.message).toContain("test_type must be a string");
    }
  );

  it("does not treat Object.prototype keys as panels", () => {
    refusal(() => validateLabPanel("toString", [{ test_name: "Hemoglobin", test_value: "14" }], "male"));
  });

  it.each([[[]], [null], [[null]], [[{ test_value: "90" }]]])("refuses malformed results %j", (results) => {
    refusal(() => validateLabPanel(FBS, results, "male"));
  });

  it("refuses the whole panel when any one value is impossible", () => {
    refusal(() =>
      validateLabPanel(
        "Complete Blood Count (CBC)",
        [
          { test_name: "Hemoglobin", test_value: "14" },
          { test_name: "Platelets", test_value: "-1" },
        ],
        "male"
      )
    );
  });

  it("accepts every parameter of every panel at a reference-range value", () => {
    for (const [panel, params] of Object.entries(LAB_TEST_GROUPS)) {
      const results = params.map((p) => {
        const r = LAB_REFERENCE_RANGES.find((x) => x.parameter === p)!;
        return { test_name: p, test_value: String(r.maleMin) };
      });
      expect(validateLabPanel(panel, results, "male")).toHaveLength(params.length);
    }
  });
});

describe("a ValidationError reaching a route", () => {
  it("answers 400 with the validator's message", async () => {
    const error = refusal(() => validateLabResult(FBS, "1e3", "male"));
    const response = handleRouteError(error, "Failed to save department records");

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toBe(error.message);
  });
});
