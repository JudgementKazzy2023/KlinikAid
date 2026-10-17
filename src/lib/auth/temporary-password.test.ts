import { describe, expect, it } from "vitest";
import { isAllowedWithTemporaryPassword, mustChangePassword } from "./temporary-password";

describe("mustChangePassword", () => {
  it("is true only for an explicit true flag", () => {
    expect(mustChangePassword({ app_metadata: { must_change_password: true } })).toBe(true);
  });

  it.each([
    ["no user", null],
    ["no flag", { app_metadata: {} }],
    ["cleared flag", { app_metadata: { must_change_password: false } }],
    ["string flag", { app_metadata: { must_change_password: "true" } }],
  ])("is false for %s", (_, user) => {
    expect(mustChangePassword(user)).toBe(false);
  });
});

describe("isAllowedWithTemporaryPassword", () => {
  it.each(["/set-password", "/login", "/logout", "/forgot-password", "/reset-password"])(
    "allows %s",
    (path) => {
      expect(isAllowedWithTemporaryPassword(path)).toBe(true);
    }
  );

  it.each([
    "/",
    "/patient/dashboard",
    "/privacy-agreement",
    "/api/chat",
    "/api/patient/documents",
    "/profile",
    "/set-passwordx",
    "/loginx",
  ])("refuses %s", (path) => {
    expect(isAllowedWithTemporaryPassword(path)).toBe(false);
  });
});
