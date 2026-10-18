import { describe, expect, it } from "vitest";
import {
  customRoleWriteErrorMessage,
  DUPLICATE_ROLE_NAME_ERROR,
  isUuid,
  normalizePermissionIds,
  UNKNOWN_PERMISSION_ERROR,
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
