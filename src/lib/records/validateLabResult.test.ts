import { describe, expect, it } from "vitest";
import { ValidationError, handleRouteError } from "@/lib/api-response";
import { LAB_NARRATIVE_MAX_LENGTH, LAB_REFERENCE_RANGES, LAB_TEST_GROUPS } from "@/lib/constants";
import {
  resultValueText,
  validateLabNarrative,
  validateLabPanel,
  validateLabResult,
  validateLabSubmission,
} from "./validateLabResult";

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

  // `{"toString": 1}` is valid JSON, and String() on it throws a TypeError:
  // these used to answer 500.
  it.each([[{ toString: 1 }], [{}], [Object.create(null)], [["90"]], [true], [null], [undefined]])(
    "refuses a test_value of type %j with a 400, not a 500",
    (value) => {
      const error = refusal(() => validateLabResult(FBS, value, "male"));
      expect(error.message).toContain("test_value must be a number or a string of digits");
    }
  );

  it("accepts a JSON number as well as a numeric string", () => {
    expect(validateLabResult(FBS, 92, "male").test_value).toBe("92");
    expect(validateLabResult(FBS, " 92.5 ", "male").test_value).toBe("92.5");
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

  it("refuses a panel whose test_value is an object, without coercing it", () => {
    const error = refusal(() => validateLabPanel(FBS, [{ test_name: FBS, test_value: { toString: 1 } }], "male"));
    expect(error.message).toContain(FBS);
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

describe("resultValueText", () => {
  it("passes strings through untouched and stringifies finite numbers", () => {
    expect(resultValueText("Clear lung fields ")).toBe("Clear lung fields ");
    expect(resultValueText("")).toBe("");
    expect(resultValueText(13.2)).toBe("13.2");
  });

  it.each([[{ toString: 1 }], [{}], [[1]], [true], [null], [undefined], [NaN], [Infinity]])(
    "returns null for %j instead of coercing it",
    (value) => {
      expect(resultValueText(value)).toBeNull();
    }
  );
});

/**
 * Issue #69: urinalysis, fecalysis, BUN, SGPT/ALT and SGOT/AST could be
 * requested but not recorded. With no documented ranges for them, they are
 * recorded as narrative text and never flagged.
 */
describe("validateLabNarrative", () => {
  it("accepts Findings alone and stores it unflagged with no range or unit", () => {
    const rows = validateLabNarrative("Urinalysis", [{ test_name: "Findings", test_value: "  Color: yellow  " }]);
    expect(rows).toEqual([
      {
        test_name: "Findings",
        test_value: "Color: yellow",
        unit: null,
        reference_range_min: null,
        reference_range_max: null,
        is_flagged: false,
      },
    ]);
  });

  it("accepts Findings with an Impression", () => {
    const rows = validateLabNarrative("SGOT / AST", [
      { test_name: "Findings", test_value: "SGOT 30 U/L" },
      { test_name: "Impression", test_value: "As reported" },
    ]);
    expect(rows.map((r) => r.test_name)).toEqual(["Findings", "Impression"]);
  });

  it("ignores a client's flag, unit and range", () => {
    const [row] = validateLabNarrative("Fecalysis", [
      { test_name: "Findings", test_value: "x", is_flagged: true, unit: "mg/dL", reference_range_min: 1 },
    ]);
    expect(row.is_flagged).toBe(false);
    expect(row.unit).toBeNull();
    expect(row.reference_range_min).toBeNull();
  });

  it("accepts a value at the length limit and refuses one past it", () => {
    const atLimit = "a".repeat(LAB_NARRATIVE_MAX_LENGTH);
    expect(validateLabNarrative("Urinalysis", [{ test_name: "Findings", test_value: atLimit }])).toHaveLength(1);
    const error = refusal(() =>
      validateLabNarrative("Urinalysis", [{ test_name: "Findings", test_value: atLimit + "a" }])
    );
    expect(error.message).toContain(`no more than ${LAB_NARRATIVE_MAX_LENGTH} characters`);
  });

  it.each(["", "   ", "\n\t"])("refuses an empty Findings %j", (value) => {
    refusal(() => validateLabNarrative("Urinalysis", [{ test_name: "Findings", test_value: value }]));
  });

  it("refuses an Impression without Findings", () => {
    const error = refusal(() =>
      validateLabNarrative("Urinalysis", [{ test_name: "Impression", test_value: "Normal" }])
    );
    expect(error.message).toContain("Findings is required");
  });

  it("refuses a repeated field", () => {
    refusal(() =>
      validateLabNarrative("Urinalysis", [
        { test_name: "Findings", test_value: "a" },
        { test_name: "Findings", test_value: "b" },
      ])
    );
  });

  it.each([[[{ test_name: "Hemoglobin", test_value: "14" }]], [[{ test_name: "findings", test_value: "a" }]]])(
    "refuses a row that is not Findings or Impression: %j",
    (results) => {
      refusal(() => validateLabNarrative("Urinalysis", results));
    }
  );

  it.each([[42], [{ toString: 1 }], [null], [undefined], [["a"]]])("refuses a non-text test_value %j", (value) => {
    const error = refusal(() => validateLabNarrative("Urinalysis", [{ test_name: "Findings", test_value: value }]));
    expect(error.message).toContain("must be text");
  });

  it.each([[[]], [null], ["Findings"], [[null]], [[{ test_value: "a" }]]])("refuses malformed results %j", (results) => {
    refusal(() => validateLabNarrative("Urinalysis", results));
  });

  it.each(["Complete Blood Count (CBC)", "Lipid Profile", "urinalysis", "Chest X-ray", { toString: 1 }])(
    "refuses a test_type that is not a narrative lab test: %j",
    (testType) => {
      refusal(() => validateLabNarrative(testType, [{ test_name: "Findings", test_value: "a" }]));
    }
  );
});

describe("validateLabSubmission", () => {
  it("routes a narrative test to narrative validation", () => {
    const rows = validateLabSubmission("Blood Urea Nitrogen (BUN)", [{ test_name: "Findings", test_value: "BUN 12" }], "male");
    expect(rows[0].is_flagged).toBe(false);
    expect(rows[0].reference_range_min).toBeNull();
  });

  it("validates a structured panel exactly as validateLabPanel does", () => {
    const results = [{ test_name: FBS, test_value: "450" }];
    expect(validateLabSubmission(FBS, results, "male")).toEqual(validateLabPanel(FBS, results, "male"));
  });

  it("does not let narrative text into a structured panel", () => {
    refusal(() => validateLabSubmission("Lipid Profile", [{ test_name: "Findings", test_value: "TG 150" }], "male"));
  });

  it("refuses an unknown test, naming both kinds", () => {
    const error = refusal(() => validateLabSubmission("Potassium", [{ test_name: "Findings", test_value: "a" }], "male"));
    expect(error.message).toContain("Urinalysis");
    expect(error.message).toContain("Fasting Blood Sugar (FBS)");
  });

  it("still refuses a non-string test_type as a ValidationError", () => {
    refusal(() => validateLabSubmission({ toString: 1 }, [{ test_name: "Findings", test_value: "a" }], "male"));
  });
});
