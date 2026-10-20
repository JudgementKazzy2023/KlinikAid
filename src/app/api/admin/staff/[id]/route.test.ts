import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH, PUT } from "./route";
import { AuthError } from "@/lib/api-response";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), update: vi.fn(), single: vi.fn(), logEvent: vi.fn(),
  revoke: vi.fn(), ban: vi.fn(), unban: vi.fn(),
  updateAuthUser: vi.fn(), roleSingle: vi.fn(),
}));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      table === "roles"
        ? { select: () => ({ eq: () => ({ single: mocks.roleSingle }) }) }
        : { update: mocks.update },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateAuthUser } } }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/auth/session-revocation", () => ({
  revokeAllSessions: mocks.revoke, banAuthUser: mocks.ban, liftAuthBan: mocks.unban,
}));

const targetId = "00000000-0000-0000-0000-000000000001";
const roleId = "00000000-0000-0000-0000-0000000000aa";
const patch = (isActive: unknown) => PATCH(new Request("http://test/api/admin/staff/" + targetId, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }),
}), { params: Promise.resolve({ id: targetId }) });

const putBody = {
  email: "throwaway.staff@example.com",
  fullName: "Throwaway Staff",
  roleId,
  department: null,
  employeeType: "Reception",
};
const put = () => PUT(new Request("http://test/api/admin/staff/" + targetId, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(putBody),
}), { params: Promise.resolve({ id: targetId }) });

/** A caller that holds every permission but the named one. */
function refuse(permission: string) {
  mocks.requirePermission.mockImplementation(async (name: string) => {
    if (name === permission) throw new AuthError(403, `FORBIDDEN: Missing permission '${name}'`);
    return { id: "admin" };
  });
}
const checkedPermissions = () => mocks.requirePermission.mock.calls.map((call) => call[0]);
const noWrites = () => {
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.updateAuthUser).not.toHaveBeenCalled();
  expect(mocks.logEvent).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.single.mockResolvedValue({ data: { full_name: "Staff", role: "receptionist" }, error: null });
  mocks.update.mockReturnValue({ eq: () => ({ select: () => ({ single: mocks.single }) }) });
  mocks.roleSingle.mockResolvedValue({
    data: { id: roleId, name: "receptionist", is_system: true, base_role: "receptionist" }, error: null,
  });
  mocks.updateAuthUser.mockResolvedValue({ error: null });
  mocks.revoke.mockResolvedValue({ ok: true });
  mocks.ban.mockResolvedValue({ ok: true });
  mocks.unban.mockResolvedValue({ ok: true });
  mocks.logEvent.mockResolvedValue({ ok: true });
});

describe("staff detail update permission preflight", () => {
  it("checks staff.manage, roles.read and profiles.manage before any Auth or profile write", async () => {
    const response = await put();
    expect(response.status).toBe(200);
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.updateAuthUser).toHaveBeenCalledWith(targetId, expect.objectContaining({ email: putBody.email }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ full_name: putBody.fullName }));
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_UPDATED",
      expect.any(String), null, expect.anything());
  });

  it("refuses an update missing profiles.manage before reading roles or touching Auth", async () => {
    refuse("profiles.manage");
    const response = await put();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("refuses an update missing roles.read before reading roles or touching Auth", async () => {
    refuse("roles.read");
    const response = await put();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("answers a caller without staff.manage without checking or running anything else", async () => {
    refuse("staff.manage");
    const response = await put();
    expect(response.status).toBe(403);
    expect(checkedPermissions()).toEqual(["staff.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });
});

describe("staff status permission preflight", () => {
  it("checks profiles.manage alongside staff.manage on an authorized toggle", async () => {
    expect((await patch(false)).status).toBe(200);
    expect(checkedPermissions()).toEqual(["staff.manage", "profiles.manage"]);
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
  });

  it("refuses deactivation without profiles.manage before writing status or Auth state", async () => {
    refuse("profiles.manage");
    const response = await patch(false);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "profiles.manage"]);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.ban).not.toHaveBeenCalled();
    noWrites();
  });

  it("refuses reactivation without profiles.manage before lifting the Auth ban", async () => {
    refuse("profiles.manage");
    const response = await patch(true);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(mocks.unban).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    noWrites();
  });

  it("still deactivates fully for an authorized caller", async () => {
    const response = await patch(false);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.revoke).toHaveBeenCalled();
    expect(mocks.ban).toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_DEACTIVATED",
      expect.any(String), null, expect.objectContaining({ sessions_revoked: true, auth_banned: true }));
  });
});

describe("staff status Auth failures", () => {
  it("reports a partial deactivation and records it when ban fails", async () => {
    mocks.ban.mockResolvedValue({ ok: false, error: "Auth unavailable" });
    const response = await patch(false);
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain("could not block new sign-ins");
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_DEACTIVATED",
      expect.any(String), null, expect.objectContaining({ sessions_revoked: true, auth_banned: false }));
  });

  it("still bans after revocation fails, keeps the profile inactive, and reports failure", async () => {
    mocks.revoke.mockResolvedValue({ ok: false, error: "Revocation unavailable" });
    const response = await patch(false);
    expect(response.status).toBe(502);
    expect(mocks.ban).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_DEACTIVATED",
      expect.any(String), null, expect.objectContaining({ sessions_revoked: false, auth_banned: true }));
  });

  it("does not activate the profile when unban fails", async () => {
    mocks.unban.mockResolvedValue({ ok: false, error: "Auth unavailable" });
    expect((await patch(true)).status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("does not activate the profile when cleanup of older sessions fails", async () => {
    mocks.revoke.mockResolvedValue({ ok: false, error: "Revocation unavailable" });
    expect((await patch(true)).status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("finishes Auth cleanup before making a profile active", async () => {
    expect((await patch(true)).status).toBe(200);
    expect(mocks.unban).toHaveBeenCalledWith(expect.anything(), targetId);
    expect(mocks.update).toHaveBeenCalledWith({ is_active: true });
    expect(mocks.unban.mock.invocationCallOrder[0]).toBeLessThan(mocks.revoke.mock.invocationCallOrder[0]);
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
  });

  it("rejects a non-boolean status before any changes", async () => {
    expect((await patch("false")).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.ban).not.toHaveBeenCalled();
  });
});
