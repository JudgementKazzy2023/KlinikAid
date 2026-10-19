import { describe, expect, it } from "vitest";
import { isDepartment, resolveDepartmentScope } from "./department-scope";

describe("resolveDepartmentScope", () => {
  describe("caller limited to the own_department permission", () => {
    it("ignores a requested department and stays in its own", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "imaging",
          ownDepartment: "laboratory",
          canSelectDepartment: false,
        })
      ).toEqual({ kind: "scoped", department: "laboratory" });
    });

    it("ignores a requested department even without a URL department", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: null,
          ownDepartment: "ecg",
          canSelectDepartment: false,
        })
      ).toEqual({ kind: "scoped", department: "ecg" });
    });

    it("ignores an invalid requested department rather than failing the request", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "pharmacy",
          ownDepartment: "ultrasound",
          canSelectDepartment: false,
        })
      ).toEqual({ kind: "scoped", department: "ultrasound" });
    });

    it("reports a missing department instead of defaulting to laboratory", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "imaging",
          ownDepartment: null,
          canSelectDepartment: false,
        })
      ).toEqual({ kind: "missing_department" });
    });

    it("reports an unusable assigned department as invalid", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: null,
          ownDepartment: "nephrology",
          canSelectDepartment: false,
        })
      ).toEqual({ kind: "invalid_department" });
    });
  });

  describe("caller holding the unscoped permission", () => {
    it("may choose another department", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "imaging",
          ownDepartment: "laboratory",
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "scoped", department: "imaging" });
    });

    it("falls back to its own department when none is requested", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: null,
          ownDepartment: "ultrasound",
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "scoped", department: "ultrasound" });
    });

    it("defaults to laboratory when it has no department of its own", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: null,
          ownDepartment: null,
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "scoped", department: "laboratory" });
    });

    it("treats an empty request as no request", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "",
          ownDepartment: null,
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "scoped", department: "laboratory" });
    });

    it("rejects an unknown department", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: "pharmacy",
          ownDepartment: "laboratory",
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "invalid_department" });
    });

    it("rejects a non-string request instead of coercing it", () => {
      expect(
        resolveDepartmentScope({
          requestedDepartment: 42,
          ownDepartment: null,
          canSelectDepartment: true,
        })
      ).toEqual({ kind: "invalid_department" });
    });
  });

  it("does not accept inherited object keys as departments", () => {
    expect(isDepartment("constructor")).toBe(false);
    expect(isDepartment("toString")).toBe(false);
    expect(isDepartment("laboratory")).toBe(true);
    expect(isDepartment(null)).toBe(false);
  });
});
