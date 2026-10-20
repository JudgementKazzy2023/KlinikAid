import { describe, expect, it } from "vitest";
import {
  validateName,
  validateAge,
  validateDobDate,
  validateAddress,
  validateNotes,
  validateRejectionReason,
  validateBloodPressure,
  BP_SYSTOLIC_MIN,
  BP_SYSTOLIC_MAX,
  BP_DIASTOLIC_MIN,
  BP_DIASTOLIC_MAX,
  BLOOD_PRESSURE_FORMAT_MESSAGE,
  BLOOD_PRESSURE_RANGE_MESSAGE,
  BLOOD_PRESSURE_ORDER_MESSAGE,
  NAME_MIN,
  NAME_MAX,
  ADDRESS_MAX,
  NOTES_MAX,
  REJECTION_REASON_MIN,
  REJECTION_REASON_MAX,
} from "./validation";

/**
 * Mirrors getTodayInPh() in validation.ts (which is module-private) so the DOB
 * lower-bound tests can compute the 120-year boundary against the real "today"
 * in Asia/Manila rather than a hardcoded date that would drift.
 */
function todayInManila() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

describe("validateName — two-character names are accepted, single still refused", () => {
  it("accepts common two-character Filipino / Chinese-Filipino surnames", () => {
    for (const surname of ["Sy", "Uy", "Go", "Co", "Jo", "Ed"]) {
      expect(validateName(surname).valid).toBe(true);
    }
  });

  it("still refuses a single character", () => {
    expect(validateName("A").valid).toBe(false);
    expect(validateName("A").error).toContain(`at least ${NAME_MIN}`);
  });

  it("accepts three characters and longer", () => {
    expect(validateName("Ana").valid).toBe(true);
  });

  it("keeps diacritics working", () => {
    for (const name of ["Niño", "Peña", "María", "José"]) {
      expect(validateName(name).valid).toBe(true);
    }
  });

  it("trims surrounding whitespace before the length check", () => {
    expect(validateName("  Sy  ").valid).toBe(true);
    expect(validateName("   ").valid).toBe(false);
  });

  it("enforces the name maximum exactly (NAME_MAX then NAME_MAX+1)", () => {
    expect(validateName("a".repeat(NAME_MAX)).valid).toBe(true);
    expect(validateName("a".repeat(NAME_MAX + 1)).valid).toBe(false);
  });
});

describe("validateDobDate / validateAge — lower bound of 120 years", () => {
  const today = todayInManila();
  const exactly120 = ymd(today.year - 120, today.month, today.day);

  // One calendar day before "exactly 120 years ago" = more than 120 years old.
  const boundary = new Date(Date.UTC(today.year - 120, today.month - 1, today.day));
  boundary.setUTCDate(boundary.getUTCDate() - 1);
  const moreThan120 = ymd(
    boundary.getUTCFullYear(),
    boundary.getUTCMonth() + 1,
    boundary.getUTCDate()
  );

  it("accepts a DOB exactly 120 years ago (boundary)", () => {
    expect(validateDobDate(exactly120).valid).toBe(true);
    expect(validateAge(exactly120).valid).toBe(true);
  });

  it("rejects a DOB more than 120 years ago", () => {
    expect(validateDobDate(moreThan120).valid).toBe(false);
    expect(validateAge(moreThan120).valid).toBe(false);
  });

  it("rejects the QA-pass 1800 DOB", () => {
    expect(validateDobDate("1800-01-01").valid).toBe(false);
    expect(validateAge("1800-01-01").valid).toBe(false);
    expect(validateDobDate("1800-01-01").error).toContain("120");
  });

  it("still rejects future and impossible dates", () => {
    expect(validateDobDate("9999-12-31").valid).toBe(false);
    expect(validateDobDate("2023-02-30").valid).toBe(false);
    expect(validateDobDate("not-a-date").valid).toBe(false);
  });

  it("validateAge still enforces the 18+ minimum, validateDobDate does not", () => {
    const seventeen = ymd(today.year - 17, today.month, today.day);
    const eighteen = ymd(today.year - 18, today.month, today.day);
    expect(validateAge(seventeen).valid).toBe(false);
    expect(validateAge(eighteen).valid).toBe(true);
    // The specialist form has no 18+ rule; only the 120-year lower bound applies.
    expect(validateDobDate(seventeen).valid).toBe(true);
  });
});

describe("validateAddress — trimmed before the not-empty check, then bounded", () => {
  it("rejects empty and whitespace-only addresses", () => {
    expect(validateAddress("").valid).toBe(false);
    expect(validateAddress("   ").valid).toBe(false);
    expect(validateAddress("\t\n").valid).toBe(false);
  });

  it("accepts a trimmed, non-empty address", () => {
    expect(validateAddress("  123 Rizal St  ").valid).toBe(true);
  });

  it("enforces the address maximum exactly (ADDRESS_MAX then ADDRESS_MAX+1)", () => {
    expect(validateAddress("a".repeat(ADDRESS_MAX)).valid).toBe(true);
    expect(validateAddress("a".repeat(ADDRESS_MAX + 1)).valid).toBe(false);
  });
});

describe("validateNotes — optional, trimmed, bounded", () => {
  it("refuses a non-string value instead of throwing", () => {
    expect(validateNotes(42).valid).toBe(false);
    expect(validateNotes({}).valid).toBe(false);
  });

  it("accepts null, empty, and whitespace-only (notes are optional)", () => {
    expect(validateNotes(null).valid).toBe(true);
    expect(validateNotes("").valid).toBe(true);
    expect(validateNotes("   ").valid).toBe(true);
  });

  it("enforces the notes maximum exactly (NOTES_MAX then NOTES_MAX+1)", () => {
    expect(validateNotes("a".repeat(NOTES_MAX)).valid).toBe(true);
    expect(validateNotes("a".repeat(NOTES_MAX + 1)).valid).toBe(false);
  });
});

describe("validateRejectionReason — minimum and maximum", () => {
  it("rejects below the minimum, including empty", () => {
    expect(validateRejectionReason("").valid).toBe(false);
    expect(validateRejectionReason("short reason").valid).toBe(false);
  });

  it("accepts exactly the minimum", () => {
    expect(validateRejectionReason("a".repeat(REJECTION_REASON_MIN)).valid).toBe(true);
  });

  it("enforces the maximum exactly (REJECTION_REASON_MAX then MAX+1)", () => {
    expect(validateRejectionReason("a".repeat(REJECTION_REASON_MAX)).valid).toBe(true);
    expect(validateRejectionReason("a".repeat(REJECTION_REASON_MAX + 1)).valid).toBe(false);
  });

  it("refuses a non-text reason instead of throwing", () => {
    expect(validateRejectionReason(123)).toEqual({ valid: false, error: "Rejection reason must be text." });
    expect(validateRejectionReason({ text: "a".repeat(30) }).valid).toBe(false);
    expect(validateRejectionReason(null).valid).toBe(false);
  });
});

describe("validateBloodPressure — optional blank, physiological bounds, systolic > diastolic", () => {
  it("accepts blank readings because vitals are optional", () => {
    expect(validateBloodPressure("").valid).toBe(true);
    expect(validateBloodPressure("   ").valid).toBe(true);
    expect(validateBloodPressure(null).valid).toBe(true);
    expect(validateBloodPressure(undefined).valid).toBe(true);
  });

  it("accepts a typical reading and trims surrounding whitespace", () => {
    expect(validateBloodPressure("120/80").valid).toBe(true);
    expect(validateBloodPressure(" 120/80 ").valid).toBe(true);
  });

  it("accepts readings exactly on every bound", () => {
    expect(validateBloodPressure(`${BP_SYSTOLIC_MIN}/${BP_DIASTOLIC_MIN}`).valid).toBe(true);
    expect(validateBloodPressure(`${BP_SYSTOLIC_MAX}/${BP_DIASTOLIC_MAX}`).valid).toBe(true);
    expect(validateBloodPressure(`${BP_DIASTOLIC_MAX + 1}/${BP_DIASTOLIC_MAX}`).valid).toBe(true);
  });

  it("rejects each value one step past a bound", () => {
    const belowSystolic = validateBloodPressure(`${BP_SYSTOLIC_MIN - 1}/${BP_DIASTOLIC_MIN}`);
    expect(belowSystolic.valid).toBe(false);
    expect(belowSystolic.error).toBe(BLOOD_PRESSURE_RANGE_MESSAGE);

    const aboveSystolic = validateBloodPressure(`${BP_SYSTOLIC_MAX + 1}/${BP_DIASTOLIC_MAX}`);
    expect(aboveSystolic.valid).toBe(false);
    expect(aboveSystolic.error).toBe(BLOOD_PRESSURE_RANGE_MESSAGE);

    const belowDiastolic = validateBloodPressure(`${BP_SYSTOLIC_MIN}/${BP_DIASTOLIC_MIN - 1}`);
    expect(belowDiastolic.valid).toBe(false);
    expect(belowDiastolic.error).toBe(BLOOD_PRESSURE_RANGE_MESSAGE);

    const aboveDiastolic = validateBloodPressure(`210/${BP_DIASTOLIC_MAX + 1}`);
    expect(aboveDiastolic.valid).toBe(false);
    expect(aboveDiastolic.error).toBe(BLOOD_PRESSURE_RANGE_MESSAGE);
  });

  it("rejects impossible readings such as 999/999", () => {
    const reading = validateBloodPressure("999/999");
    expect(reading.valid).toBe(false);
    expect(reading.error).toBe(BLOOD_PRESSURE_RANGE_MESSAGE);
  });

  it("requires systolic to be strictly higher than diastolic", () => {
    const reversed = validateBloodPressure("80/120");
    expect(reversed.valid).toBe(false);
    expect(reversed.error).toBe(BLOOD_PRESSURE_ORDER_MESSAGE);

    const equal = validateBloodPressure("120/120");
    expect(equal.valid).toBe(false);
    expect(equal.error).toBe(BLOOD_PRESSURE_ORDER_MESSAGE);

    const equalInBounds = validateBloodPressure("200/200");
    expect(equalInBounds.valid).toBe(false);
    expect(equalInBounds.error).toBe(BLOOD_PRESSURE_ORDER_MESSAGE);
  });

  it("rejects malformed readings with the format message", () => {
    for (const malformed of ["120", "1/2", "120/80/90", "abc", "1200/80", "12o/80", "120 //80", "-"]) {
      const result = validateBloodPressure(malformed);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(BLOOD_PRESSURE_FORMAT_MESSAGE);
    }
  });
});
