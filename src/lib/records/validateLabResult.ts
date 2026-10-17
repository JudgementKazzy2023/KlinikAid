import { LAB_REFERENCE_RANGES, LAB_TEST_GROUPS } from "@/lib/constants";
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
