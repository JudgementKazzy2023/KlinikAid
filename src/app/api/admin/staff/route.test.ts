import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { AuthError } from "@/lib/api-response";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), roleSingle: vi.fn(), profileSingle: vi.fn(),
  profileUpdate: vi.fn(), profileUpdateSingle: vi.fn(),
  createAuthUser: vi.fn(), deleteAuthUser: vi.fn(), logEvent: vi.fn(),
}));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      table === "roles"
        ? { select: () => ({ eq: () => ({ single: mocks.roleSingle }) }) }
        : {
            select: () => ({ eq: () => ({ single: mocks.profileSingle }) }),
            update: (values: Record<string, unknown>) => {
              mocks.profileUpdate(values);
              return { eq: () => ({ select: () => ({ single: mocks.profileUpdateSingle }) }) };
            },
          },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: mocks.createAuthUser, deleteUser: mocks.deleteAuthUser } },
  }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));

const roleId = "00000000-0000-0000-0000-0000000000aa";
const newUserId = "00000000-0000-0000-0000-0000000000bb";
const postBody = {
  email: "throwaway.staff@example.com",
  password: "Str0ng-Throwaway!",
  fullName: "Throwaway Staff",
  roleId,
  department: null,
  employeeType: "Reception",
};
const post = () => POST(new Request("http://test/api/admin/staff", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(postBody),
}));

/** A caller that holds every permission but the named one. */
function refuse(permission: string) {
  mocks.requirePermission.mockImplementation(async (name: string) => {
    if (name === permission) throw new AuthError(403, `FORBIDDEN: Missing permission '${name}'`);
    return { id: "admin" };
  });
}
const checkedPermissions = () => mocks.requirePermission.mock.calls.map((call) => call[0]);
const noWrites = () => {
  expect(mocks.createAuthUser).not.toHaveBeenCalled();
  expect(mocks.profileUpdate).not.toHaveBeenCalled();
  expect(mocks.logEvent).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.roleSingle.mockResolvedValue({
    data: { id: roleId, name: "receptionist", is_system: true, base_role: "receptionist" }, error: null,
  });
  mocks.profileSingle.mockResolvedValue({ data: { id: newUserId }, error: null });
  mocks.profileUpdateSingle.mockResolvedValue({ data: { id: newUserId, role_id: roleId }, error: null });
  mocks.createAuthUser.mockResolvedValue({ data: { user: { id: newUserId, email: postBody.email } }, error: null });
  mocks.deleteAuthUser.mockResolvedValue({ error: null });
  mocks.logEvent.mockResolvedValue({ ok: true });
});

describe("staff create permission preflight", () => {
  it("checks staff.manage, roles.read and profiles.manage before any Auth or profile write", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.createAuthUser).toHaveBeenCalledWith(expect.objectContaining({
      email: postBody.email,
      app_metadata: expect.objectContaining({ role: "receptionist" }),
    }));
    expect(mocks.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({ role_id: roleId }));
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.anything(), "admin", "STAFF_CREATED",
      expect.any(String), null, expect.anything());
  });

  it("refuses creation missing roles.read before reading roles or touching Auth", async () => {
    refuse("roles.read");
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("refuses creation missing profiles.manage before reading roles or touching Auth", async () => {
    refuse("profiles.manage");
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("answers a caller without staff.manage without checking or running anything else", async () => {
    refuse("staff.manage");
    const response = await post();
    expect(response.status).toBe(403);
    expect(checkedPermissions()).toEqual(["staff.manage"]);
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    noWrites();
  });

  it("lets a caller with staff.manage, roles.read and profiles.manage create staff without roles.manage", async () => {
    // The issue's restricted custom-role caller: staff creation must not grow a
    // roles.manage requirement, and the route must never ask for one.
    refuse("roles.manage");
    const response = await post();
    expect(response.status).toBe(201);
    expect(checkedPermissions()).toEqual(["staff.manage", "roles.read", "profiles.manage"]);
    expect(mocks.createAuthUser).toHaveBeenCalled();
    expect(mocks.profileUpdate).toHaveBeenCalledWith(expect.objectContaining({ role_id: roleId }));
  });
});

describe("staff create role validation", () => {
  it("answers an unknown roleId with 400 before any Auth work for an authorized caller", async () => {
    mocks.roleSingle.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "not found" } });
    const response = await post();
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Select a valid role.");
    noWrites();
  });
});
