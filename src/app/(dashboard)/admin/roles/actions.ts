"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import {
  customRoleWriteErrorMessage,
  isUuid,
  normalizePermissionIds,
  UNKNOWN_PERMISSION_ERROR,
  validateRoleName,
} from "@/lib/auth/custom-role-input";

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  base_role: string | null;
};

type ProfileWithRoleId = {
  role_id?: string | null;
};

/** What create_custom_role() returns (migration_32). */
type CreatedCustomRole = {
  role_id: string;
  role_name: string;
  base_role: string;
  permission_count: number;
};

/** What update_custom_role() returns (migration_32). */
type UpdatedCustomRole = CreatedCustomRole & {
  previous_role_name: string;
  previous_base_role: string | null;
};

function getCallerRoleId(profile: ProfileWithRoleId): string | null {
  return typeof profile.role_id === "string" ? profile.role_id : null;
}

export async function createCustomRoleAction(
  name: string,
  description: string,
  rawPermissionIds: string[]
) {
  try {
    const adminProfile = await requirePermission("roles.manage");

    const nameCheck = validateRoleName(name);
    if (!nameCheck.ok) {
      return { success: false, error: nameCheck.error };
    }

    const cleanName = nameCheck.name;
    const permissionIds = normalizePermissionIds(rawPermissionIds);

    if (!permissionIds.every(isUuid)) {
      return { success: false, error: UNKNOWN_PERMISSION_ERROR };
    }

    const supabase = await createClient();

    // The role row and its mappings are written in one transaction, after the
    // function has validated the name and every permission id: a failure leaves
    // no role behind.
    const { data, error: createError } = await supabase.rpc("create_custom_role", {
      p_name: cleanName,
      p_description: description || null,
      p_permission_ids: permissionIds,
    });

    if (createError) {
      console.error("Error creating custom role:", createError);
      return {
        success: false,
        error: customRoleWriteErrorMessage(createError, "Failed to create custom role."),
      };
    }

    const created: CreatedCustomRole = data;

    // Log CUSTOM_ROLE_CREATED mutation event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.CUSTOM_ROLE_CREATED,
      `Custom role '${created.role_name}' created`,
      null,
      {
        role_id: created.role_id,
        role_name: created.role_name,
        base_role: created.base_role,
        permission_count: created.permission_count,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error creating custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create custom role."
    };
  }
}

export async function updateCustomRoleAction(
  roleId: string,
  values: {
    name: string;
    description: string;
    permissionIds: string[];
  }
) {
  try {
    const adminProfile = await requirePermission("roles.manage");

    if (!isUuid(roleId)) {
      return { success: false, error: "Select a valid role." };
    }

    if (roleId === getCallerRoleId(adminProfile as ProfileWithRoleId)) {
      return { success: false, error: "You cannot modify your own assigned role." };
    }

    const nameCheck = validateRoleName(values.name);
    if (!nameCheck.ok) {
      return { success: false, error: nameCheck.error };
    }

    const cleanName = nameCheck.name;
    const cleanDescription = values.description?.trim() || null;
    const permissionIds = normalizePermissionIds(values.permissionIds);

    if (!permissionIds.every(isUuid)) {
      return { success: false, error: UNKNOWN_PERMISSION_ERROR };
    }

    const supabase = await createClient();

    // One transaction: the function locks the role, re-checks that it exists, is
    // not a system role and is not the caller's own, validates the name and every
    // permission id, then updates the row and replaces the whole permission set.
    // Any failure leaves the previous name and permissions in place.
    const { data, error: updateError } = await supabase.rpc("update_custom_role", {
      p_role_id: roleId,
      p_name: cleanName,
      p_description: cleanDescription,
      p_permission_ids: permissionIds,
    });

    if (updateError) {
      console.error("Error updating custom role:", updateError);
      return {
        success: false,
        error: customRoleWriteErrorMessage(updateError, "Failed to update custom role."),
      };
    }

    const updated: UpdatedCustomRole = data;

    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_UPDATED,
      `Custom role '${updated.role_name}' updated`,
      null,
      {
        role_id: updated.role_id,
        previous_role_name: updated.previous_role_name,
        role_name: updated.role_name,
        previous_base_role: updated.previous_base_role,
        base_role: updated.base_role,
        permission_count: updated.permission_count,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error updating custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update custom role.",
    };
  }
}

export async function deleteCustomRoleAction(roleId: string) {
  try {
    const adminProfile = await requirePermission("roles.manage");

    if (!roleId || typeof roleId !== "string") {
      return { success: false, error: "Select a valid role." };
    }

    if (roleId === getCallerRoleId(adminProfile as ProfileWithRoleId)) {
      return { success: false, error: "You cannot modify your own assigned role." };
    }

    const supabase = await createClient();

    const { data: role, error: roleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single<RoleRow>();

    if (roleError || !role) {
      return { success: false, error: "Select a valid role." };
    }

    if (role.is_system) {
      return { success: false, error: "System roles cannot be deleted." };
    }

    const { count: assignedCount, error: assignedCountError } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId);

    if (assignedCountError) {
      throw assignedCountError;
    }

    if ((assignedCount || 0) > 0) {
      return {
        success: false,
        error: `Reassign ${assignedCount} user(s) before deleting this role.`,
      };
    }

    const { error: deleteMappingsError } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteMappingsError) {
      throw deleteMappingsError;
    }

    const { error: deleteRoleError } = await supabase
      .from("roles")
      .delete()
      .eq("id", roleId);

    if (deleteRoleError) {
      throw deleteRoleError;
    }

    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_DELETED,
      `Custom role '${role.name}' deleted`,
      null,
      {
        role_id: roleId,
        role_name: role.name,
        base_role: role.base_role,
      }
    );

    revalidatePath("/admin/roles");
    return { success: true };
  } catch (err: unknown) {
    console.error("Error deleting custom role:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete custom role.",
    };
  }
}

export async function getRolesAction() {
  try {
    await requirePermission("roles.manage");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (err: unknown) {
    console.error("Error fetching roles:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to fetch roles." };
  }
}
