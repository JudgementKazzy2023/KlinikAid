import { describe, expect, it } from "vitest";
import {
  customRoleWriteErrorMessage,
  DUPLICATE_ROLE_NAME_ERROR,
  isUuid,
  normalizePermissionIds,
  ROLE_NAME_MAX,
  ROLE_NAME_TOO_LONG_ERROR,
  ROLE_NAME_TOO_SHORT_ERROR,
  UNKNOWN_PERMISSION_ERROR,
  validateRoleName,
} from "./custom-role-input";

const A = "1e4af016-b81b-4836-a6e7-fdcfe401a49c";
const B = "B5747983-DCD5-4A0D-93CC-C07B71FF1386";

describe("isUuid", () => {
  it.each([A, B])("accepts %s", (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["not hex", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"],
    ["missing group", "1e4af016-b81b-4836-a6e7"],
    ["surrounding space", ` ${A}`],
    ["sql fragment", `${A}') or ('1'='1`],
    ["number", 42],
    ["null", null],
  ])("rejects %s", (_, value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe("normalizePermissionIds", () => {
  it("drops repeats, keeping first-seen order", () => {
    expect(normalizePermissionIds([B, A, B, A])).toEqual([B, A]);
  });

  it("drops non-string and blank entries", () => {
    expect(normalizePermissionIds([A, "", "   ", null, 7, undefined, B])).toEqual([A, B]);
  });

  it("returns an empty list for a non-array", () => {
    expect(normalizePermissionIds("not-an-array")).toEqual([]);
    expect(normalizePermissionIds(undefined)).toEqual([]);
  });

  it("keeps a malformed id so the caller can reject it", () => {
    expect(normalizePermissionIds(["nope"])).toEqual(["nope"]);
  });
});

describe("validateRoleName", () => {
  it("trims surrounding whitespace", () => {
    expect(validateRoleName("  Senior Nurse  ")).toEqual({ ok: true, name: "Senior Nurse" });
  });

  it("accepts a name at exactly the shared maximum", () => {
    const exact = "a".repeat(ROLE_NAME_MAX);
    expect(validateRoleName(exact)).toEqual({ ok: true, name: exact });
  });

  it("refuses one character over the shared maximum", () => {
    expect(validateRoleName("a".repeat(ROLE_NAME_MAX + 1))).toEqual({
      ok: false,
      error: ROLE_NAME_TOO_LONG_ERROR,
    });
  });

  it("measures the trimmed name, so padded input over the limit is refused", () => {
    const padded = `  ${"a".repeat(ROLE_NAME_MAX)}  `;
    expect(validateRoleName(padded)).toEqual({ ok: true, name: "a".repeat(ROLE_NAME_MAX) });
    expect(validateRoleName(`  ${"a".repeat(ROLE_NAME_MAX + 1)}  `).ok).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["below the minimum", "ab"],
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_, value) => {
    expect(validateRoleName(value)).toEqual({ ok: false, error: ROLE_NAME_TOO_SHORT_ERROR });
  });

  it("accepts the minimum length", () => {
    expect(validateRoleName("abc")).toEqual({ ok: true, name: "abc" });
  });
});

describe("customRoleWriteErrorMessage", () => {
  const fallback = "Failed to update custom role.";

  it("passes through the messages the database functions raise", () => {
    expect(
      customRoleWriteErrorMessage({ code: "42501", message: "System roles cannot be edited." }, fallback)
    ).toBe("System roles cannot be edited.");
    expect(customRoleWriteErrorMessage({ code: "P0002", message: "Select a valid role." }, fallback)).toBe(
      "Select a valid role."
    );
  });

  it("maps a unique violation from a concurrent rename to the duplicate-name message", () => {
    expect(
      customRoleWriteErrorMessage(
        { code: "23505", message: 'duplicate key value violates unique constraint "roles_name_key"' },
        fallback
      )
    ).toBe(DUPLICATE_ROLE_NAME_ERROR);
  });

  it("maps a foreign-key violation from a concurrently deleted permission", () => {
    expect(
      customRoleWriteErrorMessage(
        { code: "23503", message: 'violates foreign key constraint "role_permissions_permission_id_fkey"' },
        fallback
      )
    ).toBe(UNKNOWN_PERMISSION_ERROR);
  });

  it.each([
    ["null", null],
    ["a string", "boom"],
    ["no message", { code: "XX000" }],
    ["empty message", { code: "XX000", message: "" }],
  ])("falls back for %s", (_, error) => {
    expect(customRoleWriteErrorMessage(error, fallback)).toBe(fallback);
  });
});
