import { describe, expect, it } from "vitest";
import {
  applyStaffFilters,
  buildStaffFilters,
  filterStaff,
  hasActiveFilters,
  matchesDepartment,
  matchesRole,
  matchesSearch,
  matchesStatus,
  parseDepartmentFilter,
  parseRoleId,
  parseStaffFilters,
  parseStatusFilter,
  resolveRoleFilter,
  type FilterableStaff,
  type RoleCatalogueEntry,
  type StaffFilters,
} from "./staff-filters";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const RECEPTIONIST_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOM_ID = "33333333-3333-4333-8333-333333333333";

const CATALOGUE: RoleCatalogueEntry[] = [
  { id: ADMIN_ID, name: "admin", is_system: true },
  { id: RECEPTIONIST_ID, name: "receptionist", is_system: true },
  { id: CUSTOM_ID, name: "Front Desk Supervisor", is_system: false },
];

function staff(overrides: Partial<FilterableStaff> & { id: string }): FilterableStaff {
  return {
    full_name: `Staff ${overrides.id}`,
    email: `${overrides.id}@example.test`,
    role: "receptionist",
    role_id: RECEPTIONIST_ID,
    department: null,
    employee_type: null,
    is_active: true,
    ...overrides,
  };
}

const REGISTRY: FilterableStaff[] = [
  staff({ id: "a", full_name: "Ana Admin", role: "admin", role_id: ADMIN_ID, department: null }),
  staff({ id: "b", full_name: "Ben Lab", role: "department_staff", role_id: null, department: "laboratory" }),
  staff({ id: "c", full_name: "Cara Imaging", role: "department_staff", role_id: null, department: "imaging" }),
  staff({ id: "d", full_name: "Dan Custom", role: "receptionist", role_id: CUSTOM_ID, department: null }),
  staff({ id: "e", full_name: "Eve Retired", role: "receptionist", role_id: RECEPTIONIST_ID, is_active: false }),
];

const NO_FILTERS: StaffFilters = { role: null, department: null, status: null };

describe("role filter", () => {
  it("keeps only the staff whose role id is the selected role", () => {
    const filters = buildStaffFilters({ roleId: ADMIN_ID, department: null, status: null }, CATALOGUE);
    expect(filterStaff(REGISTRY, filters).map((s) => s.full_name)).toEqual(["Ana Admin"]);
  });

  it("matches a custom role by its id, not by the base role it inherits", () => {
    const filters = buildStaffFilters({ roleId: CUSTOM_ID, department: null, status: null }, CATALOGUE);
    // Dan carries the custom role. Ben and Cara are plain department staff and
    // a custom role's legacy text is its *base* role, so they must not match.
    expect(filterStaff(REGISTRY, filters).map((s) => s.full_name)).toEqual(["Dan Custom"]);
  });

  it("matches a legacy row that has no role id, through the system role's text", () => {
    const filters = buildStaffFilters(
      { roleId: RECEPTIONIST_ID, department: null, status: null },
      CATALOGUE
    );
    const matched = filterStaff(REGISTRY, filters).map((s) => s.full_name);
    // Eve carries the receptionist role id. The legacy department staff rows
    // carry the text "department_staff", which is a different role, and Dan
    // carries a custom role id, so neither is a receptionist.
    expect(matched).toEqual(["Eve Retired"]);
  });

  it("does not let a custom role claim rows that only carry its base role", () => {
    const filters = buildStaffFilters({ roleId: CUSTOM_ID, department: null, status: null }, CATALOGUE);
    const baseRoleRows = REGISTRY.filter((s) => s.role === "receptionist" && s.role_id === null);
    expect(baseRoleRows).toHaveLength(0);
    expect(matchesRole(baseRoleRows[0] ?? staff({ id: "x", role_id: null, role: "receptionist" }), filters.role!)).toBe(
      false
    );
  });

  it("keeps the filter for a role id the catalogue does not know", () => {
    const unknown = "99999999-9999-4999-8999-999999999999";
    const filter = resolveRoleFilter(unknown, CATALOGUE);
    expect(filter).not.toBeNull();
    expect(filterStaff(REGISTRY, { ...NO_FILTERS, role: filter! })).toHaveLength(0);
  });
});

describe("department filter", () => {
  it("keeps only the staff of the chosen department", () => {
    expect(
      filterStaff(REGISTRY, { ...NO_FILTERS, department: "laboratory" }).map((s) => s.full_name)
    ).toEqual(["Ben Lab"]);
  });

  it("treats 'none' as staff without a department", () => {
    expect(
      filterStaff(REGISTRY, { ...NO_FILTERS, department: "none" }).map((s) => s.full_name)
    ).toEqual(["Ana Admin", "Dan Custom", "Eve Retired"]);
  });

  it("does not confuse a missing department with a named one", () => {
    expect(matchesDepartment(staff({ id: "x", department: null }), "none")).toBe(true);
    expect(matchesDepartment(staff({ id: "x", department: null }), "laboratory")).toBe(false);
    expect(matchesDepartment(staff({ id: "x", department: "ecg" }), "none")).toBe(false);
  });
});

describe("status filter", () => {
  it("keeps active staff and inactive staff separately", () => {
    expect(filterStaff(REGISTRY, { ...NO_FILTERS, status: "active" }).map((s) => s.full_name)).toEqual([
      "Ana Admin",
      "Ben Lab",
      "Cara Imaging",
      "Dan Custom",
    ]);
    expect(filterStaff(REGISTRY, { ...NO_FILTERS, status: "inactive" }).map((s) => s.full_name)).toEqual([
      "Eve Retired",
    ]);
  });

  it("reads the status from the row, not from the absence of a filter", () => {
    expect(matchesStatus(staff({ id: "x", is_active: true }), "active")).toBe(true);
    expect(matchesStatus(staff({ id: "x", is_active: true }), "inactive")).toBe(false);
    expect(matchesStatus(staff({ id: "x", is_active: false }), "inactive")).toBe(true);
  });
});

describe("search", () => {
  it("matches name, email, role text and title, case-insensitively", () => {
    const row = staff({ id: "s", full_name: "Rosa Ruiz", email: "rosa@example.test", employee_type: "Lab Tech" });
    expect(matchesSearch(row, "ruiz")).toBe(true);
    expect(matchesSearch(row, "ROSA@EXAMPLE")).toBe(true);
    expect(matchesSearch(row, "lab tech")).toBe(true);
    expect(matchesSearch(row, "receptionist")).toBe(true);
    expect(matchesSearch(row, "nothing")).toBe(false);
  });

  it("matches everything when the term is empty", () => {
    expect(matchesSearch(staff({ id: "s" }), "")).toBe(true);
    expect(matchesSearch(staff({ id: "s" }), "   ")).toBe(true);
  });
});

describe("combining the filters with the search", () => {
  it("keeps only the rows that satisfy every dimension", () => {
    const filters = buildStaffFilters(
      { roleId: null, department: "laboratory", status: "active" },
      CATALOGUE
    );
    expect(filterStaff(REGISTRY, filters, "ben").map((s) => s.full_name)).toEqual(["Ben Lab"]);
  });

  it("narrows further when a search term is added", () => {
    const filters = buildStaffFilters(
      { roleId: null, department: null, status: "inactive" },
      CATALOGUE
    );
    expect(filterStaff(REGISTRY, filters).map((s) => s.full_name)).toEqual(["Eve Retired"]);
    expect(filterStaff(REGISTRY, filters, "ana")).toEqual([]);
  });

  it("never returns a row the unfiltered list does not contain", () => {
    const filters = buildStaffFilters(
      { roleId: CUSTOM_ID, department: "none", status: "active" },
      CATALOGUE
    );
    const rows = filterStaff(REGISTRY, filters);
    expect(rows.map((s) => s.full_name)).toEqual(["Dan Custom"]);
    expect(rows.length).toBeLessThanOrEqual(REGISTRY.length);
  });

  it("returns every row when nothing is filtered", () => {
    expect(filterStaff(REGISTRY, NO_FILTERS)).toHaveLength(REGISTRY.length);
  });
});

describe("reading the filter state from the URL", () => {
  it("reads a complete filter set", () => {
    const params = new URLSearchParams(
      `role=${RECEPTIONIST_ID}&department=laboratory&status=active`
    );
    expect(parseStaffFilters(params)).toEqual({
      roleId: RECEPTIONIST_ID,
      department: "laboratory",
      status: "active",
    });
  });

  it("drops values the filter dimensions do not know", () => {
    const params = new URLSearchParams("role=not-a-role&department=pharmacy&status=maybe");
    expect(parseStaffFilters(params)).toEqual({ roleId: null, department: null, status: null });
  });

  it("treats 'all' and an empty value as no filter", () => {
    const params = new URLSearchParams("role=all&department=all&status=");
    expect(parseStaffFilters(params)).toEqual({ roleId: null, department: null, status: null });
  });

  it("keeps a valid value even when the others are invalid", () => {
    const params = new URLSearchParams("department=ecg&status=inactive&role=nope");
    expect(parseStaffFilters(params)).toEqual({
      roleId: null,
      department: "ecg",
      status: "inactive",
    });
  });

  it("accepts a role id in any case and rejects one that is not a uuid", () => {
    expect(parseRoleId(RECEPTIONIST_ID.toUpperCase())).toBe(RECEPTIONIST_ID);
    expect(parseRoleId("2222")).toBeNull();
    expect(parseRoleId("22222222-2222-4222-8222-22222222222")).toBeNull();
  });

  it("rejects a department or status it does not know", () => {
    expect(parseDepartmentFilter("laboratory")).toBe("laboratory");
    expect(parseDepartmentFilter("none")).toBe("none");
    expect(parseDepartmentFilter("Laboratory")).toBe("laboratory");
    expect(parseDepartmentFilter("x-ray")).toBeNull();
    expect(parseStatusFilter("active")).toBe("active");
    expect(parseStatusFilter("inactive")).toBe("inactive");
    expect(parseStatusFilter("Active ")).toBe("active");
    expect(parseStatusFilter("deleted")).toBeNull();
  });
});

describe("writing the filter state back to the URL", () => {
  it("writes the selected filters and leaves other parameters alone", () => {
    const params = new URLSearchParams("tab=system");
    const next = applyStaffFilters(params, {
      roleId: RECEPTIONIST_ID,
      department: "imaging",
      status: "inactive",
    });
    expect(next.get("tab")).toBe("system");
    expect(next.get("role")).toBe(RECEPTIONIST_ID);
    expect(next.get("department")).toBe("imaging");
    expect(next.get("status")).toBe("inactive");
  });

  it("removes a filter that is cleared", () => {
    const params = new URLSearchParams(`role=${RECEPTIONIST_ID}&department=ecg`);
    const next = applyStaffFilters(params, { roleId: null, department: null });
    expect(next.get("role")).toBeNull();
    expect(next.get("department")).toBeNull();
  });

  it("leaves a dimension alone when it is not part of the change", () => {
    const params = new URLSearchParams("status=active");
    const next = applyStaffFilters(params, { department: "ecg" });
    expect(next.get("status")).toBe("active");
    expect(next.get("department")).toBe("ecg");
  });

  it("round-trips through the parser", () => {
    const params = applyStaffFilters(new URLSearchParams(), {
      roleId: CUSTOM_ID,
      department: "none",
      status: "active",
    });
    expect(parseStaffFilters(params)).toEqual({
      roleId: CUSTOM_ID,
      department: "none",
      status: "active",
    });
  });
});

describe("hasActiveFilters", () => {
  it("is false until a dimension is chosen", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, status: "active" })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, department: "none" })).toBe(true);
    expect(
      hasActiveFilters({ role: resolveRoleFilter(CUSTOM_ID, CATALOGUE), department: null, status: null })
    ).toBe(true);
  });
});
