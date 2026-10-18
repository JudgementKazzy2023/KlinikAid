import {
  LAB_NARRATIVE_FIELDS,
  LAB_NARRATIVE_MAX_LENGTH,
  LAB_NARRATIVE_TESTS,
  LAB_REFERENCE_RANGES,
  LAB_TEST_GROUPS,
  type LabNarrativeField,
  type LabNarrativeTest,
} from "@/lib/constants";
import { ValidationError } from "@/lib/api-response";

export interface ValidatedLabResult {
  test_value: string;
  unit: string | null;
  reference_range_min: number;
  reference_range_max: number;
  is_flagged: boolean;
}

export interface ValidatedPanelResult extends ValidatedLabResult {
  test_name: string;
}

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * The text of a submitted result value, or null if its type is not one a
 * client can legitimately send (a string, or a finite JSON number).
 *
 * Check this before coercing: `{"toString": 1}` is valid JSON, and String() on
 * it throws a TypeError, which surfaced as a 500 instead of a 400.
 */
export function resultValueText(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Validates one lab value and works out whether it is flagged.
 *
 * Two different ranges apply, and they mean different things:
 *
 *   - outside the *reference* range: abnormal. Saved, with `is_flagged` set.
 *   - outside the *plausible* range: not a measurement. Refused.
 *
 * Every refusal is a `ValidationError`, so a route answers 400 with the message
 * rather than 500. This used to throw a bare `Error`, which is how `1e3` came to
 * report "Failed to save department records" as a server fault.
 */
export function validateLabResult(
  testName: string,
  rawValue: unknown,
  gender: string | null | undefined
): ValidatedLabResult {
  const range = LAB_REFERENCE_RANGES.find((ref) => ref.parameter === testName);
  if (!range) {
    throw new ValidationError(`${testName} is not a recognised lab parameter.`);
  }

  const text = resultValueText(rawValue);
  if (text === null) {
    throw new ValidationError(`${testName}: test_value must be a number or a string of digits.`);
  }
  const value = text.trim();
  if (!STRICT_NUMBER_REGEX.test(value)) {
    throw new ValidationError(
      `${testName}: "${value}" is not a valid number. Enter digits with an optional decimal point, e.g. 95 or 13.2.`
    );
  }

  const numericValue = Number(value);
  if (
    !Number.isFinite(numericValue) ||
    numericValue < range.plausibleMin ||
    numericValue > range.plausibleMax
  ) {
    throw new ValidationError(
      `${testName}: ${value} ${range.unit} is outside the possible range ` +
        `(${range.plausibleMin}–${range.plausibleMax} ${range.unit}). Check the value and its unit.`
    );
  }

  const isFemale = gender?.toLowerCase() === "female";
  const min = isFemale ? range.femaleMin : range.maleMin;
  const max = isFemale ? range.femaleMax : range.maleMax;

  return {
    test_value: value,
    unit: range.unit,
    reference_range_min: min,
    reference_range_max: max,
    is_flagged: numericValue < min || numericValue > max,
  };
}

function isLabPanel(value: string): value is keyof typeof LAB_TEST_GROUPS {
  return Object.prototype.hasOwnProperty.call(LAB_TEST_GROUPS, value);
}

/**
 * Validates a whole laboratory submission: the panel, that every result belongs
 * to it, and each value.
 *
 * Both lab write paths -- `POST /api/department/records` and the specialist
 * record action -- go through this, so the rules cannot drift between them. The
 * out-of-range confirm dialog in the entry forms is a courtesy; this is the
 * check that a direct API call also meets.
 */
export function validateLabPanel(
  testType: unknown,
  results: unknown,
  gender: string | null | undefined
): ValidatedPanelResult[] {
  // Never String() a non-string here: `{"toString": 1}` is valid JSON, and
  // String() on it throws a TypeError, which surfaced as a 500.
  if (typeof testType !== "string") {
    throw new ValidationError(
      `test_type must be a string. Expected one of: ${Object.keys(LAB_TEST_GROUPS).join(", ")}.`
    );
  }
  if (!isLabPanel(testType)) {
    throw new ValidationError(
      `"${testType}" is not a lab panel. Expected one of: ${Object.keys(LAB_TEST_GROUPS).join(", ")}.`
    );
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new ValidationError("At least one result is required.");
  }

  const allowed: readonly string[] = LAB_TEST_GROUPS[testType];

  return results.map((result: unknown) => {
    if (typeof result !== "object" || result === null) {
      throw new ValidationError("Each result must be an object with test_name and test_value.");
    }

    const { test_name, test_value } = result as { test_name?: unknown; test_value?: unknown };

    if (typeof test_name !== "string" || !test_name) {
      throw new ValidationError("Each result must have a test_name.");
    }
    if (!allowed.includes(test_name)) {
      throw new ValidationError(
        `${test_name} is not part of ${testType}. Expected: ${allowed.join(", ")}.`
      );
    }

    return { test_name, ...validateLabResult(test_name, test_value, gender) };
  });
}

export interface ValidatedNarrativeResult {
  test_name: LabNarrativeField;
  test_value: string;
  unit: null;
  reference_range_min: null;
  reference_range_max: null;
  is_flagged: false;
}

export function isLabNarrativeTest(value: unknown): value is LabNarrativeTest {
  return typeof value === "string" && (LAB_NARRATIVE_TESTS as readonly string[]).includes(value);
}

function isLabNarrativeField(value: unknown): value is LabNarrativeField {
  return typeof value === "string" && (LAB_NARRATIVE_FIELDS as readonly string[]).includes(value);
}

/**
 * Validates a narrative laboratory result: Findings, and optionally Impression,
 * for a requested test that has no structured panel.
 *
 * Nothing here is flagged and no range or unit is stored, whatever the client
 * sends. These tests have no documented reference ranges, so the system makes
 * no normal/abnormal claim about them.
 */
export function validateLabNarrative(testType: unknown, results: unknown): ValidatedNarrativeResult[] {
  if (!isLabNarrativeTest(testType)) {
    throw new ValidationError(
      `test_type must be one of the narrative laboratory tests: ${LAB_NARRATIVE_TESTS.join(", ")}.`
    );
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new ValidationError("At least one result is required.");
  }

  const seen = new Set<LabNarrativeField>();
  const rows = results.map((result: unknown): ValidatedNarrativeResult => {
    if (typeof result !== "object" || result === null) {
      throw new ValidationError("Each result must be an object with test_name and test_value.");
    }

    const { test_name, test_value } = result as { test_name?: unknown; test_value?: unknown };

    if (!isLabNarrativeField(test_name)) {
      throw new ValidationError(
        `${testType} is recorded as narrative text. Each result must be one of: ${LAB_NARRATIVE_FIELDS.join(", ")}.`
      );
    }
    if (seen.has(test_name)) {
      throw new ValidationError(`${test_name} was submitted more than once.`);
    }
    seen.add(test_name);

    if (typeof test_value !== "string") {
      throw new ValidationError(`${test_name}: test_value must be text.`);
    }
    const text = test_value.trim();
    if (!text) {
      throw new ValidationError(`${test_name} must not be empty.`);
    }
    if (text.length > LAB_NARRATIVE_MAX_LENGTH) {
      throw new ValidationError(
        `${test_name} must be no more than ${LAB_NARRATIVE_MAX_LENGTH} characters.`
      );
    }

    return {
      test_name,
      test_value: text,
      unit: null,
      reference_range_min: null,
      reference_range_max: null,
      is_flagged: false,
    };
  });

  if (!seen.has("Findings")) {
    throw new ValidationError("Findings is required for a narrative laboratory result.");
  }

  return rows;
}

/**
 * Validates a laboratory submission from the department entry form: a
 * structured panel or a narrative test, chosen by test_type. The two sets of
 * names are disjoint, so the choice is never ambiguous.
 *
 * The specialist record action calls validateLabPanel directly and does not
 * accept narrative results.
 */
export function validateLabSubmission(
  testType: unknown,
  results: unknown,
  gender: string | null | undefined
): (ValidatedPanelResult | ValidatedNarrativeResult)[] {
  if (isLabNarrativeTest(testType)) {
    return validateLabNarrative(testType, results);
  }
  if (typeof testType === "string" && !isLabPanel(testType)) {
    throw new ValidationError(
      `"${testType}" is not a laboratory test. Expected a panel (${Object.keys(LAB_TEST_GROUPS).join(", ")}) ` +
        `or a narrative test (${LAB_NARRATIVE_TESTS.join(", ")}).`
    );
  }
  return validateLabPanel(testType, results, gender);
}
