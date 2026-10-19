import { DEPARTMENTS } from "@/lib/constants";
import type { Department } from "@/types";

/**
 * Which department a department request may act on.
 *
 * Decided by permissions, never by the legacy `profiles.role` text column: a
 * caller who only holds the `*.own_dept` variants is pinned to their own
 * `profiles.department`, and a caller holding the unscoped permission (for
 * example `queue.manage` or `records.manage`) may choose one. Permissions
 * resolve through `role_id` -> `role_permissions`, so a custom role holding
 * only `queue.manage.own_dept` is scoped exactly like the system
 * department_staff role.
 *
 * The requested department is untrusted input (query string or request body),
 * so it is typed `unknown` and anything that is not one of the four department
 * ids is rejected rather than coerced.
 */
export type DepartmentScope =
  | { kind: "scoped"; department: Department }
  | { kind: "missing_department" }
  | { kind: "invalid_department" };

export function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEPARTMENTS, value);
}

export interface DepartmentScopeInput {
  /** Raw requested department, or null when the caller did not ask for one. */
  requestedDepartment: unknown;
  /** The caller's own `profiles.department`. */
  ownDepartment: string | null;
  /** True only for the unscoped permission (e.g. `records.manage`). */
  canSelectDepartment: boolean;
}

export function resolveDepartmentScope({
  requestedDepartment,
  ownDepartment,
  canSelectDepartment,
}: DepartmentScopeInput): DepartmentScope {
  const own = isDepartment(ownDepartment) ? ownDepartment : null;

  if (!canSelectDepartment) {
    if (!ownDepartment) {
      return { kind: "missing_department" };
    }
    // An assigned department the app cannot act on is a configuration fault,
    // not a request the caller may widen.
    if (!own) {
      return { kind: "invalid_department" };
    }
    return { kind: "scoped", department: own };
  }

  const requested =
    typeof requestedDepartment === "string" ? requestedDepartment.trim() : requestedDepartment;

  if (requested !== null && requested !== undefined && requested !== "") {
    return isDepartment(requested)
      ? { kind: "scoped", department: requested }
      : { kind: "invalid_department" };
  }

  if (own) {
    return { kind: "scoped", department: own };
  }

  if (ownDepartment) {
    return { kind: "invalid_department" };
  }

  return { kind: "scoped", department: "laboratory" };
}
