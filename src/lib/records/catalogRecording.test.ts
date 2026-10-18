import { describe, expect, it } from "vitest";
import {
  CLINIC_TEST_CATALOG,
  DEPARTMENTS,
  LAB_NARRATIVE_TESTS,
  LAB_PANEL_LABELS,
  LAB_REFERENCE_RANGES,
  LAB_TEST_GROUPS,
  testTypeLabel,
} from "@/lib/constants";
import { validateLabSubmission } from "./validateLabResult";

/**
 * Issue #69: the request catalog offered tests that the receiving department
 * had no way to record. Every requestable test must name a recording path that
 * the server actually accepts.
 */
describe("every requestable test can be recorded", () => {
  it.each(CLINIC_TEST_CATALOG.map((test) => [test.id, test] as const))("%s", (_id, test) => {
    const recording = test.recording;
    expect(DEPARTMENTS).toHaveProperty(recording.department);

    if ("panel" in recording) {
      const params = LAB_TEST_GROUPS[recording.panel];
      const results = params.map((p) => {
        const range = LAB_REFERENCE_RANGES.find((r) => r.parameter === p)!;
        return { test_name: p, test_value: String(range.maleMin) };
      });
      expect(validateLabSubmission(recording.panel, results, "male")).toHaveLength(params.length);
    } else if ("narrative" in recording) {
      const rows = validateLabSubmission(recording.narrative, [{ test_name: "Findings", test_value: "As reported" }], "male");
      expect(rows).toHaveLength(1);
      expect(rows[0].is_flagged).toBe(false);
    } else {
      // Imaging, ultrasound and ECG record every test as free-text Findings/Impression.
      expect(recording.department).not.toBe("laboratory");
    }
  });

  it("keeps narrative test names apart from panel names", () => {
    for (const name of LAB_NARRATIVE_TESTS) {
      expect(Object.keys(LAB_TEST_GROUPS)).not.toContain(name);
    }
  });

  it("offers every narrative test for some catalog entry", () => {
    const used = CLINIC_TEST_CATALOG.flatMap((t) => ("narrative" in t.recording ? [t.recording.narrative] : []));
    expect([...used].sort()).toEqual([...LAB_NARRATIVE_TESTS].sort());
  });
});

describe("lab panel labels", () => {
  it("does not label the one-parameter panels as full panels", () => {
    expect(LAB_PANEL_LABELS["Renal Function"]).toBe("Creatinine");
    expect(LAB_PANEL_LABELS["Lipid Profile"]).toBe("Cholesterol (total)");
  });

  it("relabels stored lab panel test_types only for laboratory rows", () => {
    expect(testTypeLabel("laboratory", "Lipid Profile")).toBe("Cholesterol (total)");
    expect(testTypeLabel("laboratory", "Urinalysis")).toBe("Urinalysis");
    expect(testTypeLabel("imaging", "Renal Function")).toBe("Renal Function");
    expect(testTypeLabel("laboratory", "toString")).toBe("toString");
  });
});
