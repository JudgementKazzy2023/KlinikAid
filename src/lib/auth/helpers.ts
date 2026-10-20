import { cache } from "react";
import { AuthError } from "@/lib/api-response";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/auth/session";
import { timed } from "@/lib/perf/timing";
import { Profile, UserRole, Department } from "@/types";
import { User } from "@supabase/supabase-js";

/**
 * The profile row of a user, read once per request.
 *
 * `cache()` collapses the reads made by the dashboard layout, the page
 * helpers and the auth guards into one query: the layout and the page used to
 * read the same row separately, and each read is a round trip to the database.
 */
export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  try {
    const supabase = await createClient();
    const { data, error } = await timed("auth.profiles.select", () =>
      supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single()
    );

    if (error || !data) {
      return null;
    }

    return data as Profile;
  } catch (error) {
    console.error("Error in getProfile:", error);
    return null;
  }
});

/**
 * Retrieves the current authenticated user and their associated profile.
 * Server-side only (Server Components, Actions, Routes).
 */
export const getCurrentUser = cache(async (): Promise<{
  user: User | null;
  profile: Profile | null;
}> => {
  const user = await getRequestUser();

  if (!user) {
    return { user: null, profile: null };
  }

  const profile = await getProfile(user.id);

  return { user, profile };
});

/**
 * Session plus profile, rejecting a deactivated account. Deactivation does not
 * end an access token that was already issued, so every guard checks the flag.
 */
async function requireActiveSession(): Promise<{ user: User; profile: Profile }> {
  const { user, profile } = await getCurrentUser();

  if (!user || !profile) {
    throw new AuthError(401, "UNAUTHORIZED: Session not found");
  }

  if (!profile.is_active) {
    throw new AuthError(403, "FORBIDDEN: Account is deactivated");
  }

  return { user, profile };
}

/**
 * Server guard: Enforces that the active user possesses one of the allowed roles.
 * Returns the profile if successful, otherwise throws an error.
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<Profile> {
  const { profile } = await requireActiveSession();

  if (!allowedRoles.includes(profile.role)) {
    throw new AuthError(403, `FORBIDDEN: User role '${profile.role}' does not match required roles`);
  }

  return profile;
}

/**
 * Whether the user holds a permission.
 *
 * The check is the `user_has_permission` database function, unchanged: it is
 * where the role/permission mapping and the MFA requirement live. `cache()`
 * means a permission asked for twice in one request - the dashboard layout
 * asks for the same handful twice - is asked for once.
 */
export const hasPermission = cache(
  async (userId: string, permissionName: string): Promise<boolean> => {
    const supabase = await createClient();
    const { data, error } = await timed(`auth.rpc.user_has_permission(${permissionName})`, () =>
      supabase.rpc("user_has_permission", {
        p_user_id: userId,
        p_permission_name: permissionName,
      })
    );

    if (error) {
      console.error("Permission check failed:", error.message);
      return false;
    }

    return data === true;
  }
);

export const hasAnyPermission = cache(
  async (userId: string, permissionNames: string[]): Promise<boolean> => {
    const checks = await Promise.all(
      permissionNames.map((permissionName) => hasPermission(userId, permissionName))
    );
    return checks.some(Boolean);
  }
);

export async function getDefaultLandingPath(userId: string, profile: Pick<Profile, "role">): Promise<string> {
  const [
    canManageProfiles,
    canReadRoles,
    canManageStaff,
    canReadSystemLogs,
    canManageRag,
    canManageDocuments,
    canManageQueue,
    canManagePatients,
    canAccessDepartmentRecords,
    canAccessSpecialistPatients,
  ] = await Promise.all([
    hasPermission(userId, "profiles.manage"),
    hasPermission(userId, "roles.read"),
    hasPermission(userId, "staff.manage"),
    hasPermission(userId, "system_logs.read"),
    hasPermission(userId, "rag_documents.manage"),
    hasPermission(userId, "documents.manage"),
    hasPermission(userId, "queue.manage"),
    hasPermission(userId, "patients.manage"),
    hasAnyPermission(userId, ["queue.manage", "queue.manage.own_dept", "records.manage", "records.manage.own_dept"]),
    hasPermission(userId, "specialist.patients"),
  ]);

  if (profile.role === "admin" && canManageProfiles) {
    return "/admin/dashboard";
  }

  if (canManageDocuments && canManageQueue) {
    return "/reception/queue";
  }

  if (canManagePatients) {
    return "/reception/dashboard";
  }

  if (canAccessDepartmentRecords) {
    return "/department/records";
  }

  if (canAccessSpecialistPatients) {
    return "/specialist/dashboard";
  }

  if (canReadRoles) {
    return "/admin/roles";
  }

  if (canReadSystemLogs) {
    return "/admin/logs";
  }

  if (canManageRag) {
    return "/admin/rag";
  }

  if (canManageStaff) {
    return "/admin/staff";
  }

  if (profile.role === "patient") {
    return "/patient/dashboard";
  }

  return "/profile";
}

/**
 * The session's profile and a permission answer, read together.
 *
 * The profile read and the permission check are independent - both need only
 * the user id - so they run at the same time instead of one after the other.
 * Each round trip to the database is the most expensive part of a page load
 * (issue #165), and the order of the checks below is unchanged, so a missing
 * or deactivated account still reports the same error as before.
 */
async function requireSessionWithPermission(
  permissionNames: string[]
): Promise<{ profile: Profile; allowed: boolean }> {
  const user = await getRequestUser();

  if (!user) {
    throw new AuthError(401, "UNAUTHORIZED: Session not found");
  }

  const [profile, allowed] = await Promise.all([
    getProfile(user.id),
    permissionNames.length === 1
      ? hasPermission(user.id, permissionNames[0])
      : hasAnyPermission(user.id, permissionNames),
  ]);

  if (!profile) {
    throw new AuthError(401, "UNAUTHORIZED: Session not found");
  }

  if (!profile.is_active) {
    throw new AuthError(403, "FORBIDDEN: Account is deactivated");
  }

  return { profile, allowed };
}

export async function requirePermission(permissionName: string): Promise<Profile> {
  const { profile, allowed } = await requireSessionWithPermission([permissionName]);

  if (!allowed) {
    throw new AuthError(403, `FORBIDDEN: Missing permission '${permissionName}'`);
  }

  return profile;
}

export async function requireAnyPermission(permissionNames: string[]): Promise<Profile> {
  const { profile, allowed } = await requireSessionWithPermission(permissionNames);

  if (!allowed) {
    throw new AuthError(403, `FORBIDDEN: Missing one of permissions '${permissionNames.join(", ")}'`);
  }

  return profile;
}

/**
 * Server guard: Enforces that the authenticated user belongs to a specific department.
 * Returns the profile if successful, otherwise throws an error.
 */
export async function requireDepartment(allowedDepartments: Department[]): Promise<Profile> {
  const profile = await requireRole(["admin", "department_staff"]);

  // Admins bypass department isolation at application level
  if (profile.role === "admin") {
    return profile;
  }

  if (!profile.department || !allowedDepartments.includes(profile.department)) {
    throw new AuthError(
      403,
      `FORBIDDEN: Department '${profile.department || "none"}' does not match required departments`
    );
  }

  return profile;
}
