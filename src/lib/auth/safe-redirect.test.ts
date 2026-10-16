import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    "/patient/results",
    "/reception/queue?status=pending",
    "/admin/logs#system",
  ])("keeps the same-origin path %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    ["absolute URL", "https://example.com/x"],
    ["http URL", "http://example.com"],
    ["protocol-relative", "//example.com/x"],
    ["backslash", "/\\example.com"],
    ["encoded backslash", "/%5Cexample.com"],
    ["encoded slash", "/%2Fexample.com"],
    ["encoded protocol-relative", "%2F%2Fexample.com"],
    ["tab inside", "/\t/example.com"],
    ["newline inside", "/\n/example.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without slash", "patient/results"],
    ["malformed encoding", "/%E0%A4%A"],
  ])("refuses %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it("treats a missing value as no redirect", () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath("")).toBeNull();
  });
});
