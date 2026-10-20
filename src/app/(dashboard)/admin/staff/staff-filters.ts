/**
 * Pure filter rules for the Personnel Registry (/admin/staff).
 *
 * The page owns the URL, the role catalogue and the loaded rows; this module
 * owns one question: "which of these rows does this filter select?". Keeping
 * the two apart is what makes the rules testable without a browser -- the
 * acceptance criteria for this feature are all about which rows survive a
 * filter, and those are exactly the claims a unit test can make.
 *
 * Nothing here reads the DOM, React or the clock.
 */

/** The value the "All ..." options carry in the UI. Never a real filter. */
export const FILTER_ALL = "all";

export type DepartmentFilterValue = "laboratory" | "imaging" | "ultrasound" | "ecg" | "none";
export type StatusFilterValue = "active" | "inactive";

export const DEPARTMENT_FILTER_VALUES: readonly DepartmentFilterValue[] = [
  "laboratory",
  "imaging",
  "ultrasound",
  "ecg",
  "none",
];

export const STATUS_FILTER_VALUES: readonly StatusFilterValue[] = ["active", "inactive"];

/**
 * A catalogue row, as far as the filter rules care about it.
 *
 * `profiles.role_id` is nullable, so a profile can carry a role id, a legacy
 * role text, or both. The catalogue therefore has to be consulted to know
 * whether a legacy text can still stand for a role.
 */
export interface RoleCatalogueEntry {
  id: string;
  name: string;
  is_system: boolean;
}

/** The role a filter points at. */
export interface RoleFilter {
  /** `roles.id` of the selected role. */
  id: string;
  /**
   * The legacy `profiles.role` text a profile created before `role_id`
   * existed may still carry -- or null when no profile can carry it.
   *
   * Only a system role has one. A custom role stores its *base* role in the
   * legacy column, and the base role is a different role, so treating a
   * custom role's base text as a synonym would file base-role staff under
   * the custom role.
   */
  legacyName: string | null;
}

export interface StaffFilters {
  /** null means "every role". */
  role: RoleFilter | null;
  /** null means "every department". */
  department: DepartmentFilterValue | null;
  /** null means "both statuses". */
  status: StatusFilterValue | null;
}

/** The parts of a staff row the filter rules read. */
export interface FilterableStaff {
  full_name: string;
  email: string;
  role: string;
  role_id: string | null;
  department: string | null;
  employee_type: string | null;
  is_active: boolean;
}

/** The filter state as it arrives from the URL, before the catalogue is consulted. */
export interface ParsedStaffFilters {
  roleId: string | null;
  department: DepartmentFilterValue | null;
  status: StatusFilterValue | null;
}

/**
 * `roles.id` is a uuid, so anything else in the query string is not a role
 * this page can select. Rejecting it here keeps a hand-edited or stale link
 * from becoming a filter that silently matches nothing.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoleId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === FILTER_ALL) return null;
  return UUID_PATTERN.test(value) ? value : null;
}

export function parseDepartmentFilter(raw: string | null | undefined): DepartmentFilterValue | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === FILTER_ALL) return null;
  return DEPARTMENT_FILTER_VALUES.includes(value as DepartmentFilterValue)
    ? (value as DepartmentFilterValue)
    : null;
}

export function parseStatusFilter(raw: string | null | undefined): StatusFilterValue | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === FILTER_ALL) return null;
  return STATUS_FILTER_VALUES.includes(value as StatusFilterValue)
    ? (value as StatusFilterValue)
    : null;
}

/**
 * Read the filter state out of a query string.
 *
 * A parameter that is missing, empty, "all" or not a value this filter
 * dimension knows is dropped: the view then shows everything rather than an
 * unexplained empty list.
 */
export function parseStaffFilters(params: URLSearchParams): ParsedStaffFilters {
  return {
    roleId: parseRoleId(params.get("role")),
    department: parseDepartmentFilter(params.get("department")),
    status: parseStatusFilter(params.get("status")),
  };
}

/**
 * Resolve a role id against the live catalogue.
 *
 * An id the catalogue does not know keeps its filter. The rows that carry it
 * are simply not rows this registry holds, and "no match" is truer than
 * quietly dropping the filter the link asks for.
 */
export function resolveRoleFilter(
  roleId: string | null,
  catalogue: RoleCatalogueEntry[]
): RoleFilter | null {
  if (!roleId) return null;
  const entry = catalogue.find((role) => role.id === roleId);
  return { id: roleId, legacyName: entry?.is_system ? entry.name : null };
}

export function buildStaffFilters(
  parsed: ParsedStaffFilters,
  catalogue: RoleCatalogueEntry[]
): StaffFilters {
  return {
    role: resolveRoleFilter(parsed.roleId, catalogue),
    department: parsed.department,
    status: parsed.status,
  };
}

/**
 * Write the filter state back into a query string, leaving every other
 * parameter alone.
 */
export function applyStaffFilters(
  params: URLSearchParams,
  filters: { roleId?: string | null; department?: DepartmentFilterValue | null; status?: StatusFilterValue | null }
): URLSearchParams {
  const next = new URLSearchParams(params);

  if (filters.roleId === undefined) {
    // unchanged
  } else if (filters.roleId) {
    next.set("role", filters.roleId);
  } else {
    next.delete("role");
  }

  if (filters.department === undefined) {
    // unchanged
  } else if (filters.department) {
    next.set("department", filters.department);
  } else {
    next.delete("department");
  }

  if (filters.status === undefined) {
    // unchanged
  } else if (filters.status) {
    next.set("status", filters.status);
  } else {
    next.delete("status");
  }

  return next;
}

export function matchesRole(staff: FilterableStaff, filter: RoleFilter): boolean {
  if (staff.role_id) return staff.role_id === filter.id;
  // No role id: only a system role can still be identified by its legacy text.
  return filter.legacyName !== null && staff.role === filter.legacyName;
}

export function matchesDepartment(staff: FilterableStaff, value: DepartmentFilterValue): boolean {
  if (value === "none") return !staff.department;
  return staff.department === value;
}

export function matchesStatus(staff: FilterableStaff, value: StatusFilterValue): boolean {
  return value === "active" ? staff.is_active : !staff.is_active;
}

/** The free-text search the registry has always had, over the same fields. */
export function matchesSearch(staff: FilterableStaff, query: string): boolean {
  const term = (query ?? "").trim().toLowerCase();
  if (!term) return true;
  return (
    staff.full_name.toLowerCase().includes(term) ||
    staff.email.toLowerCase().includes(term) ||
    staff.role.toLowerCase().includes(term) ||
    (staff.employee_type || "").toLowerCase().includes(term)
  );
}

/**
 * The rows a filter selects. Every dimension is optional and they combine with
 * AND, so a filtered view is always a subset of the unfiltered one.
 */
export function filterStaff<T extends FilterableStaff>(
  staff: T[],
  filters: StaffFilters,
  search = ""
): T[] {
  return staff.filter(
    (member) =>
      (!filters.role || matchesRole(member, filters.role)) &&
      (!filters.department || matchesDepartment(member, filters.department)) &&
      (!filters.status || matchesStatus(member, filters.status)) &&
      matchesSearch(member, search)
  );
}

export function hasActiveFilters(filters: StaffFilters): boolean {
  return filters.role !== null || filters.department !== null || filters.status !== null;
}
