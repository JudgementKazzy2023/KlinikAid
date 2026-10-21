"use client";

import React, { useId, useState, useTransition } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/PageHeader";
import { createCustomRoleAction, deleteCustomRoleAction, updateCustomRoleAction } from "./actions";
import { ROLE_NAME_MAX, validateRoleName } from "@/lib/auth/custom-role-input";
import { roleLabel } from "@/app/(dashboard)/admin/staff/staff-form";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  base_role: string | null;
}

interface Permission {
  id: string;
  name: string;
  description: string | null;
  module: string;
}

interface Mapping {
  role_id: string;
  permission_id: string;
}

interface RolesClientProps {
  roles: Role[];
  permissions: Permission[];
  mappings: Mapping[];
}

/** `knowledge` → `Knowledge`: module keys are lower-case identifiers. */
function moduleLabel(module: string): string {
  return module.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

interface PermissionCatalogPickerProps {
  modules: string[];
  permissions: Permission[];
  selectedPermissionIds: string[];
  onTogglePermission: (permissionId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

function PermissionCatalogPicker({
  modules,
  permissions,
  selectedPermissionIds,
  onTogglePermission,
  onSelectAll,
  onDeselectAll,
}: PermissionCatalogPickerProps) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          <span id={headingId}>Permissions</span>
          <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">
            {selectedPermissionIds.length} of {permissions.length} selected
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onSelectAll}>
            Select all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDeselectAll}>
            Clear
          </Button>
        </div>
      </div>
      <div className="grid gap-x-8 gap-y-6 p-4 sm:grid-cols-2">
        {modules.map((mod) => {
          const modPerms = permissions.filter((p) => p.module === mod);
          return (
            <div key={mod} className="min-w-0 space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {moduleLabel(mod)}
              </h4>
              <div className="space-y-2.5">
                {modPerms.map((perm) => {
                  const checked = selectedPermissionIds.includes(perm.id);
                  return (
                    <label key={perm.id} className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onTogglePermission(perm.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-400 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-sm text-slate-900 dark:text-slate-100">
                          {perm.description || perm.name}
                        </span>
                        {perm.description ? (
                          <span className="block break-all font-mono text-xs text-slate-600 dark:text-slate-400">
                            {perm.name}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RoleCardProps {
  role: Role;
  permissions: Permission[];
  onEdit?: () => void;
  onDelete?: () => void;
}

function RoleCard({ role, permissions, onEdit, onDelete }: RoleCardProps) {
  const label = roleLabel(role);
  // System roles are stored as identifiers (`department_staff`); keep the
  // identifier visible next to its readable label, since policies and code use it.
  const showIdentifier = label !== role.name;
  const byModule = new Map<string, Permission[]>();
  for (const perm of permissions) {
    byModule.set(perm.module, [...(byModule.get(perm.module) ?? []), perm]);
  }

  return (
    <Card className="border border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="grid-cols-[1fr_auto] gap-x-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">{label}</CardTitle>
            {showIdentifier ? (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {role.name}
              </code>
            ) : null}
            {role.is_system ? (
              <Badge
                variant="outline"
                className="border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                <Lock aria-hidden className="h-3 w-3" />
                Built-in
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {role.description || "No description provided."}
          </p>
        </div>
        {onEdit || onDelete ? (
          <div className="flex items-center gap-1 self-start">
            {onEdit ? (
              <Button type="button" variant="outline" onClick={onEdit} aria-label={`Edit ${label}`}>
                <Pencil aria-hidden />
                Edit
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onDelete}
                aria-label={`Delete ${label}`}
                title={`Delete ${label}`}
                className="text-slate-600 hover:bg-destructive/10 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-400"
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="border-t border-slate-100 pt-4 dark:border-slate-800/60">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Permissions <span className="font-normal normal-case tracking-normal">· {permissions.length}</span>
        </h4>
        {permissions.length > 0 ? (
          <dl className="space-y-2.5">
            {Array.from(byModule, ([mod, perms]) => (
              <div key={mod} className="grid gap-1.5 sm:grid-cols-[8rem_1fr] sm:gap-4">
                <dt className="pt-0.5 text-sm text-slate-600 dark:text-slate-400">{moduleLabel(mod)}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {perms.map((perm) => (
                    <span
                      key={perm.id}
                      title={perm.description || undefined}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {perm.name}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">No permissions granted.</p>
        )}
      </CardContent>
    </Card>
  );
}

interface RoleSectionProps {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}

function RoleSection({ title, description, count, children }: RoleSectionProps) {
  const headingId = `roles-section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-white">
          {title} <span className="font-normal text-slate-600 dark:text-slate-400">({count})</span>
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function RolesClient({ roles, permissions, mappings }: RolesClientProps) {
  const [isPending, startTransition] = useTransition();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleDesc, setEditRoleDesc] = useState("");
  const [editSelectedPermissions, setEditSelectedPermissions] = useState<string[]>([]);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // Group permissions by module
  const modules = Array.from(new Set(permissions.map((p) => p.module)));

  // Maps role_id -> Set of permission_ids
  const rolePermissionsMap = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    mappings.forEach((m) => {
      if (!map.has(m.role_id)) {
        map.set(m.role_id, new Set());
      }
      map.get(m.role_id)!.add(m.permission_id);
    });
    return map;
  }, [mappings]);

  // Toggle permission checkbox
  const handleTogglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
  };

  const handleToggleEditPermission = (permId: string) => {
    setEditSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId]
    );
  };

  const handleEditOpen = (role: Role) => {
    setEditingRole(role);
    setEditRoleName(role.name);
    setEditRoleDesc(role.description || "");
    setEditSelectedPermissions(Array.from(rolePermissionsMap.get(role.id) || []));
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    if (!editRoleName.trim()) {
      toast.error("Please enter a role name.");
      return;
    }

    const nameCheck = validateRoleName(editRoleName);
    if (!nameCheck.ok) {
      toast.error(nameCheck.error);
      return;
    }

    startTransition(async () => {
      const result = await updateCustomRoleAction(editingRole.id, {
        name: editRoleName,
        description: editRoleDesc,
        permissionIds: editSelectedPermissions,
      });

      if (result.success) {
        toast.success(`Custom role '${nameCheck.name}' updated successfully.`);
        setEditingRole(null);
      } else {
        toast.error(result.error || "Failed to update role.");
      }
    });
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;

    startTransition(async () => {
      const result = await deleteCustomRoleAction(deletingRole.id);

      if (result.success) {
        toast.success(`Custom role '${deletingRole.name}' deleted successfully.`);
        setDeletingRole(null);
      } else {
        toast.error(result.error || "Failed to delete role.");
      }
    });
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) {
      toast.error("Please enter a role name.");
      return;
    }

    const nameCheck = validateRoleName(newRoleName);
    if (!nameCheck.ok) {
      toast.error(nameCheck.error);
      return;
    }

    startTransition(async () => {
      const result = await createCustomRoleAction(
        newRoleName,
        newRoleDesc,
        selectedPermissions
      );

      if (result.success) {
        toast.success(`Custom role '${nameCheck.name}' created successfully.`);
        setNewRoleName("");
        setNewRoleDesc("");
        setShowCreateForm(false);
      } else {
        toast.error(result.error || "Failed to create role.");
      }
    });
  };

  const permissionsFor = (role: Role) => {
    const ids = rolePermissionsMap.get(role.id) || new Set<string>();
    return permissions.filter((p) => ids.has(p.id));
  };
  const customRoles = roles.filter((role) => !role.is_system);
  const systemRoles = roles.filter((role) => role.is_system);

  const labelClass = "text-sm font-medium text-slate-900 dark:text-slate-100";
  const hintClass = "text-xs text-slate-600 dark:text-slate-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Role & Access Management"
        description="Review the built-in roles, and create custom roles with the permissions they grant"
        actions={
          !showCreateForm && (
            <Button
              onClick={() => {
                setShowCreateForm(true);
                setSelectedPermissions([]);
              }}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              <Plus className="h-4 w-4" />
              Create Custom Role
            </Button>
          )
        }
      />

      {/* Create custom role */}
      {showCreateForm && (
        <Card className="border border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800/60">
            <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">New custom role</CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
              Name the role and choose the permissions it grants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateRole} className="space-y-6">
              <div className="flex flex-col gap-6 lg:flex-row">
                <div className="w-full shrink-0 space-y-4 lg:w-72 xl:w-80">
                  <div className="space-y-2">
                    <Label htmlFor="role-name" className={labelClass}>Role name</Label>
                    <Input
                      id="role-name"
                      placeholder="e.g. Junior Lab Technician"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      className="h-10"
                    />
                    <p className={hintClass}>
                      Up to {ROLE_NAME_MAX} characters; surrounding spaces are ignored.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role-desc" className={labelClass}>Description</Label>
                    <Textarea
                      id="role-desc"
                      placeholder="What is this role for?"
                      value={newRoleDesc}
                      onChange={(e) => setNewRoleDesc(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>

                <div className="w-full min-w-0 lg:flex-1">
                  <PermissionCatalogPicker
                    modules={modules}
                    permissions={permissions}
                    selectedPermissionIds={selectedPermissions}
                    onTogglePermission={handleTogglePermission}
                    onSelectAll={() => setSelectedPermissions(permissions.map((permission) => permission.id))}
                    onDeselectAll={() => setSelectedPermissions([])}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800/60">
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)} className="h-9">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isPending ? "Creating..." : "Save Custom Role"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] !max-w-5xl overflow-y-auto bg-white dark:bg-slate-900 sm:!max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
              Edit {editingRole ? roleLabel(editingRole) : "custom role"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              Update this custom role&apos;s name, description, and granted permissions.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateRole} className="space-y-6">
            <div className="flex flex-col gap-6 lg:flex-row">
              <div className="w-full shrink-0 space-y-4 lg:w-72 xl:w-80">
                <div className="space-y-2">
                  <Label htmlFor="edit-role-name" className={labelClass}>Role name</Label>
                  <Input
                    id="edit-role-name"
                    value={editRoleName}
                    onChange={(e) => setEditRoleName(e.target.value)}
                    className="h-10"
                  />
                  <p className={hintClass}>
                    Up to {ROLE_NAME_MAX} characters; surrounding spaces are ignored.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-role-desc" className={labelClass}>Description</Label>
                  <Textarea
                    id="edit-role-desc"
                    value={editRoleDesc}
                    onChange={(e) => setEditRoleDesc(e.target.value)}
                    rows={4}
                  />
                </div>

                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                  Permission changes take effect on each affected user&apos;s next request or login.
                </p>
              </div>

              <div className="w-full min-w-0 lg:flex-1">
                <PermissionCatalogPicker
                  modules={modules}
                  permissions={permissions}
                  selectedPermissionIds={editSelectedPermissions}
                  onTogglePermission={handleToggleEditPermission}
                  onSelectAll={() => setEditSelectedPermissions(permissions.map((permission) => permission.id))}
                  onDeselectAll={() => setEditSelectedPermissions([])}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingRole(null)} className="h-9">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingRole} onOpenChange={(open) => !open && setDeletingRole(null)}>
        <DialogContent className="bg-white dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
              Delete {deletingRole ? roleLabel(deletingRole) : "custom role"}?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600 dark:text-slate-400">
              The role is removed only if no staff accounts are assigned to it. If any are,
              deletion is blocked until they are moved to another role.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeletingRole(null)} className="h-9">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={handleDeleteRole}
              className="h-9 bg-red-700 font-semibold text-white hover:bg-red-800"
            >
              {isPending ? "Deleting..." : "Delete Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoleSection
        title="Custom roles"
        description="Roles created for this clinic. Edit them at any time; a role can be deleted once no staff are assigned to it."
        count={customRoles.length}
      >
        {customRoles.length > 0 ? (
          customRoles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              permissions={permissionsFor(role)}
              onEdit={() => handleEditOpen(role)}
              onDelete={() => setDeletingRole(role)}
            />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            No custom roles yet. Use Create Custom Role to add one.
          </p>
        )}
      </RoleSection>

      <RoleSection
        title="System roles"
        description="Built into KlinikAid. They cannot be edited or deleted here."
        count={systemRoles.length}
      >
        {systemRoles.map((role) => (
          <RoleCard key={role.id} role={role} permissions={permissionsFor(role)} />
        ))}
      </RoleSection>
    </div>
  );
}
