import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard's authorisation path after issue #165.
 *
 * The identity comes from the access token's signature rather than from a
 * round trip to the Auth server, so these tests pin the parts that must not
 * change: which errors a guard raises, in which order, and that a permission
 * answer is never mistaken for a profile.
 */

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  profileSelect: vi.fn(),
  profileEq: vi.fn(),
  profileSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock("@/lib/perf/timing", () => ({
  timed: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (...args: unknown[]) => {
          mocks.profileEq(...args);
          return { single: mocks.profileSingle };
        },
      }),
    }),
    rpc: mocks.rpc,
  }),
}));

const { getCurrentUser, getProfile, hasPermission, requirePermission, requireAnyPermission, requireRole } =
  await import("./helpers");

const ACTIVE_PROFILE = {
  id: "u-1",
  full_name: "E2E Admin",
  role: "admin",
  role_id: "r-1",
  department: null,
  employee_type: null,
  is_active: true,
  accepted_privacy_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUser.mockResolvedValue({ id: "u-1", email: "admin@example.com" });
  mocks.profileEq.mockReturnValue(undefined);
  mocks.profileSingle.mockResolvedValue({ data: ACTIVE_PROFILE, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("getCurrentUser", () => {
  it("returns the session user together with the profile row", async () => {
    const { user, profile } = await getCurrentUser();
    expect(user?.id).toBe("u-1");
    expect(profile?.role).toBe("admin");
  });

  it("returns no user when the request carries no verified session", async () => {
    mocks.getRequestUser.mockResolvedValue(null);
    const { user, profile } = await getCurrentUser();
    expect(user).toBeNull();
    expect(profile).toBeNull();
  });

  it("keeps the user but reports no profile when the profile row cannot be read", async () => {
    mocks.profileSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { user, profile } = await getCurrentUser();
    expect(user?.id).toBe("u-1");
    expect(profile).toBeNull();
  });

  it("reads the profile of the signed-in user only", async () => {
    await getProfile("u-1");
    expect(mocks.profileEq).toHaveBeenCalledWith("id", "u-1");
  });
});

describe("requirePermission", () => {
  it("returns the profile when the permission is held", async () => {
    const profile = await requirePermission("staff.manage");
    expect(profile.id).toBe("u-1");
    expect(mocks.rpc).toHaveBeenCalledWith("user_has_permission", {
      p_user_id: "u-1",
      p_permission_name: "staff.manage",
    });
  });

  it("refuses a request without a session", async () => {
    mocks.getRequestUser.mockResolvedValue(null);
    await expect(requirePermission("staff.manage")).rejects.toMatchObject({
      status: 401,
      message: "UNAUTHORIZED: Session not found",
    });
  });

  it("refuses a deactivated account even when the permission would be held", async () => {
    mocks.profileSingle.mockResolvedValue({
      data: { ...ACTIVE_PROFILE, is_active: false },
      error: null,
    });
    await expect(requirePermission("staff.manage")).rejects.toMatchObject({
      status: 403,
      message: "FORBIDDEN: Account is deactivated",
    });
  });

  it("refuses a missing permission with the name of the permission", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requirePermission("staff.manage")).rejects.toMatchObject({
      status: 403,
      message: "FORBIDDEN: Missing permission 'staff.manage'",
    });
  });

  it("refuses a failed permission check instead of treating it as granted", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requirePermission("staff.manage")).rejects.toMatchObject({ status: 403 });
  });
});

describe("requireAnyPermission", () => {
  it("accepts a caller that holds one of the permissions", async () => {
    mocks.rpc.mockImplementation(async (_fn: string, args: { p_permission_name: string }) => ({
      data: args.p_permission_name === "queue.manage",
      error: null,
    }));
    const profile = await requireAnyPermission(["queue.manage", "records.manage"]);
    expect(profile.id).toBe("u-1");
  });

  it("refuses a caller that holds none of them", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireAnyPermission(["queue.manage", "records.manage"])).rejects.toMatchObject({
      status: 403,
      message: "FORBIDDEN: Missing one of permissions 'queue.manage, records.manage'",
    });
  });
});

describe("requireRole", () => {
  it("returns the profile for an allowed role", async () => {
    const profile = await requireRole(["admin", "receptionist"]);
    expect(profile.role).toBe("admin");
  });

  it("refuses a role the caller does not hold", async () => {
    await expect(requireRole(["receptionist"])).rejects.toMatchObject({
      status: 403,
      message: "FORBIDDEN: User role 'admin' does not match required roles",
    });
  });
});

describe("hasPermission", () => {
  it("answers with the database's answer", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(hasPermission("u-1", "roles.read")).resolves.toBe(true);
  });

  it("denies the permission when the check itself fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(hasPermission("u-1", "roles.read")).resolves.toBe(false);
  });
});
