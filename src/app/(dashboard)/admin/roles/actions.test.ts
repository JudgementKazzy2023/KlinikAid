import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomRoleAction, getRolesAction } from "./actions";
import { AuthError } from "@/lib/api-response";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ order: mocks.order }) }) }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const checkedPermissions = () => mocks.requirePermission.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.order.mockResolvedValue({ data: [{ id: "1", name: "receptionist" }], error: null });
});

describe("role catalogue read for the staff page", () => {
  it("loads the catalogue with roles.read, the permission the staff write paths require", async () => {
    const result = await getRolesAction();
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected a catalogue");
    expect(result.data).toHaveLength(1);
    expect(checkedPermissions()).toEqual(["roles.read"]);
  });

  it("reports a failed read instead of an empty catalogue", async () => {
    mocks.order.mockResolvedValue({ data: null, error: Object.assign(new Error("boom"), { code: "XX000" }) });
    const result = await getRolesAction();
    expect(result.success).toBe(false);
  });
});

describe("role management stays gated on roles.manage", () => {
  it("refuses a custom-role write from a caller without roles.manage", async () => {
    mocks.requirePermission.mockRejectedValue(
      new AuthError(403, "FORBIDDEN: Missing permission 'roles.manage'")
    );
    const result = await createCustomRoleAction("Some Role", "", []);
    expect(result.success).toBe(false);
    expect(checkedPermissions()).toEqual(["roles.manage"]);
  });
});
