import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateName } from "@/lib/validation";
import {
  type AuthStepOutcome,
  banAuthUser,
  liftAuthBan,
  revokeAllSessions,
} from "@/lib/auth/session-revocation";

export const dynamic = "force-dynamic";

function normalizeEmployeeType(value: unknown) {
  if (typeof value !== "string") return null;
  const titles = value
    .split("|")
    .map((title) => title.trim().replace(/\|/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((title) => title.slice(0, 80));

  return titles.length ? titles.join("|") : null;
}

// PUT: update staff details (full name, email, role, department)
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const adminProfile = await requirePermission("staff.manage");
    // Preflight every permission the complete update needs before any Auth or
    // profile work starts, matching the staff-create route (#43, #111): the role
    // lookup below reads roles through the caller-scoped client (roles.read) and
    // the profile write goes through the same client (profiles.manage). Checked
    // only where each step runs, a denial instead surfaces as "Select a valid
    // role." or as a 500, after Auth has already been touched.
    await requirePermission("roles.read");
    await requirePermission("profiles.manage");
    const { id } = params;
    const body = await request.json();
    const { email, fullName, roleId, department } = body;
    const employeeType = normalizeEmployeeType(body.employeeType);

    if (!email || !fullName || !roleId) {
      return errorResponse("Missing required fields: email, fullName, roleId", 400);
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) {
      return errorResponse(nameCheck.error ?? "Invalid full name.", 400);
    }

    const adminClient = createAdminClient();
    const supabase = await createClient();

    // Look up role details from DB
    const { data: dbRole, error: dbRoleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();

    if (dbRoleError || !dbRole) {
      return errorResponse("Select a valid role.", 400);
    }

    if (dbRole.is_system && dbRole.name === "patient") {
      return errorResponse("The patient role cannot be assigned to staff members.", 400);
    }

    const legacyRoleText = dbRole.is_system ? dbRole.name : dbRole.base_role;

    if (legacyRoleText === "department_staff" && (!department || department === null)) {
      return errorResponse("Clinical department is required for Department Staff.", 400);
    }

    // 1. Update Auth user (email & metadata only — password changes are client-driven via forgot-password or profile)
    // Role and department are mirrored into app_metadata, matching where the signup
    // trigger reads privilege from. The profiles row is updated directly in step 2.
    const updateParams: {
      email: string;
      user_metadata: {
        full_name: string;
        employee_type: string | null;
      };
      app_metadata: {
        role: string;
        department: string | null;
      };
    } = {
      email,
      user_metadata: {
        full_name: fullName,
        employee_type: employeeType,
      },
      app_metadata: {
        role: legacyRoleText,
        department: legacyRoleText === "department_staff" ? department : null,
      },
    };

    const { error: authError } = await adminClient.auth.admin.updateUserById(id, updateParams);

    if (authError) {
      throw authError;
    }

    // 2. Update profiles database record
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        role: legacyRoleText,
        role_id: roleId,
        department: legacyRoleText === "department_staff" ? department : null,
        employee_type: employeeType,
      })
      .eq("id", id)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    // 3. Log the update event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.STAFF_UPDATED,
      `Staff user updated: ${fullName} (${email}) as ${legacyRoleText}`,
      null,
      { target_user_id: id, role: legacyRoleText, department, employee_type: employeeType }
    );

    // 4. Emit the ROLE_ASSIGNED event (Condition 2)
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_ASSIGNED,
      `Role '${dbRole.name}' assigned to staff member ${fullName}`,
      null,
      { target_user_id: id, role_id: roleId, role_name: dbRole.name, base_role: dbRole.base_role }
    );

    return successResponse({ ...profile, email }, "Staff member updated successfully");
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to update staff member");
  }
}

// PATCH: toggle staff active status (activate / deactivate)
//
// Deactivation updates the profile first, so every is_active guard refuses the
// account even if Auth then fails, and then ends its sessions and bans it.
// Reactivation does Auth first and the profile last, so a failure leaves the
// account deactivated. It also ends sessions again, because a session that
// outlived its deactivation (one deactivated before revocation existed, or a
// revocation that failed) must not come back with the account.
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const adminProfile = await requirePermission("staff.manage");
    // The status write below runs through the caller-scoped client and is
    // governed by profiles.manage (#43, #111). Check it before any Auth or
    // profile work: reactivation lifts the Auth ban first, so without this
    // preflight a caller holding staff.manage alone would change Auth state
    // and then fail on the profile write.
    await requirePermission("profiles.manage");
    const { id } = params;
    const body = await request.json();
    const { isActive } = body;

    if (typeof isActive !== "boolean") {
      return errorResponse("Missing isActive boolean in request body", 400);
    }

    const supabase = await createClient();
    const adminClient = createAdminClient();

    if (isActive) {
      const unban = await liftAuthBan(adminClient, id);
      const revoke = unban.ok ? await revokeAllSessions(adminClient, id) : null;
      if (!unban.ok || !revoke?.ok) {
        const authError = !unban.ok ? unban.error : revoke && !revoke.ok ? revoke.error : null;
        await logEvent(
          supabase,
          adminProfile.id,
          SYSTEM_EVENT_TYPES.STAFF_ACTION_FAILED,
          `Staff reactivation failed in Auth; profile status unchanged`,
          null,
          {
            target_user_id: id,
            action: "activate",
            auth_ban_lifted: unban.ok,
            sessions_revoked: revoke?.ok ?? false,
            auth_error: authError,
          }
        );
        return errorResponse(
          "The authentication service could not complete activation. The profile status was not changed; please try again.",
          502,
          authError
        );
      }
    }

    // 1. Update active status in profiles table
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({
        is_active: isActive,
      })
      .eq("id", id)
      .select()
      .single();

    if (profileError) {
      throw profileError;
    }

    // 2. On deactivation, end every session and refuse new ones. Revocation
    // goes first: Auth will not issue the temporary session it needs to a
    // banned user, so banning first would make it impossible.
    let revoke: AuthStepOutcome = { ok: true };
    let ban: AuthStepOutcome | null = null;
    if (!isActive) {
      revoke = await revokeAllSessions(adminClient, id);
      ban = await banAuthUser(adminClient, id);
    }
    const authError = !revoke.ok ? revoke.error : ban && !ban.ok ? ban.error : null;

    // 3. Log the active status toggle
    const eventType = isActive ? SYSTEM_EVENT_TYPES.STAFF_ACTIVATED : SYSTEM_EVENT_TYPES.STAFF_DEACTIVATED;
    await logEvent(
      supabase,
      adminProfile.id,
      eventType,
      `Staff user ${isActive ? "activated" : "deactivated"}: ${profile.full_name} (${profile.role})`,
      null,
      isActive
        ? { target_user_id: id, auth_ban_lifted: true, sessions_revoked: true }
        : { target_user_id: id, sessions_revoked: revoke.ok, auth_banned: ban?.ok ?? false, auth_error: authError }
    );

    if (authError) {
      return errorResponse(
        revoke.ok
          ? `${profile.full_name} was deactivated and their sessions were ended, but the authentication service could not block new sign-ins. KlinikAid still blocks this inactive account; please try again.`
          : `${profile.full_name} was deactivated and is blocked from KlinikAid, but the authentication service did not confirm their sessions were ended. Session cleanup will be retried before the account can be reactivated.`,
        502,
        authError
      );
    }

    return successResponse(profile, `Staff member ${isActive ? "activated" : "deactivated"} successfully`);
  } catch (error: unknown) {
    return handleRouteError(error, "Failed to update staff status");
  }
}
