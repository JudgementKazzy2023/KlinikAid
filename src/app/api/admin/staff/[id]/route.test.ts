import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), update: vi.fn(), single: vi.fn(), logEvent: vi.fn(),
  revoke: vi.fn(), ban: vi.fn(), unban: vi.fn(),
}));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ update: mocks.update }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/auth/session-revocation", () => ({
  revokeAllSessions: mocks.revoke, banAuthUser: mocks.ban, liftAuthBan: mocks.unban,
}));

const targetId = "00000000-0000-0000-0000-000000000001";
const patch = (isActive: unknown) => PATCH(new Request("http://test/api/admin/staff/" + targetId, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }),
}), { params: Promise.resolve({ id: targetId }) });

describe("staff status Auth failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ id: "admin" });
    mocks.single.mockResolvedValue({ data: { full_name: "Staff", role: "receptionist" }, error: null });
    mocks.update.mockReturnValue({ eq: () => ({ select: () => ({ single: mocks.single }) }) });
    mocks.revoke.mockResolvedValue({ ok: true });
    mocks.ban.mockResolvedValue({ ok: true });
    mocks.unban.mockResolvedValue({ ok: true });
    mocks.logEvent.mockResolvedValue(undefined);
  });

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
    expect(mocks.unban.mock.invocationCallOrder[0]).toBeLessThan(mocks.revoke.mock.invocationCallOrder[0]);
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
  });

  it("rejects a non-boolean status before any changes", async () => {
    expect((await patch("false")).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.ban).not.toHaveBeenCalled();
  });
});
