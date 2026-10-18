/**
 * Input handling for the custom-role server actions.
 *
 * The authoritative checks run in the database, inside create_custom_role() /
 * update_custom_role() (migration_32), in the same transaction as the write.
 * This module only shapes what the actions send, and turns the errors those
 * functions raise into the messages the roles page shows.
 */

export const UNKNOWN_PERMISSION_ERROR = "One or more selected permissions do not exist.";
export const DUPLICATE_ROLE_NAME_ERROR = "A role with this name already exists.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Drops non-string and blank entries and repeats, keeping first-seen order. */
export function normalizePermissionIds(permissionIds: unknown): string[] {
  if (!Array.isArray(permissionIds)) return [];
  return Array.from(
    new Set(permissionIds.filter((permissionId): permissionId is string => typeof permissionId === "string" && permissionId.trim().length > 0))
  );
}

/**
 * The message to show for a failed create_custom_role / update_custom_role call.
 *
 * The functions raise their validation errors with the user-facing text as the
 * message, so those pass through. A constraint can still fire after validation
 * when another request changes the same data first (a role takes the name, a
 * permission is deleted); those carry Postgres' own wording and are mapped.
 */
export function customRoleWriteErrorMessage(error: unknown, fallback: string): string {
  const record = typeof error === "object" && error !== null ? (error as { code?: unknown; message?: unknown }) : null;

  if (record?.code === "23505") return DUPLICATE_ROLE_NAME_ERROR;
  if (record?.code === "23503") return UNKNOWN_PERMISSION_ERROR;

  return typeof record?.message === "string" && record.message.length > 0 ? record.message : fallback;
}
