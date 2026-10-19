import { describe, expect, it } from "vitest";
import {
  validateName,
  validateAge,
  validateDobDate,
  validateAddress,
  validateNotes,
  validateRejectionReason,
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
