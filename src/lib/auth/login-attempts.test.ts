import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginLoginAttempt, claimTotpCode, lockedOutMessage } from "./login-attempts";

const { rpc, single } = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

describe("beginLoginAttempt", () => {
  beforeEach(() => {
    rpc.mockReset().mockReturnValue({ single });
    single.mockReset();
  });

  it("passes an empty string for an unknown IP so it still keys a row", async () => {
    single.mockResolvedValue({ data: { allowed: true, retry_after: null }, error: null });
    expect(await beginLoginAttempt("a@b.c", null)).toEqual({ kind: "allowed" });
    expect(rpc).toHaveBeenCalledWith("begin_login_attempt", { p_email: "a@b.c", p_ip: "" });
  });

  it("reports a lock with its expiry", async () => {
    const until = "2026-10-16T12:15:00.000Z";
    single.mockResolvedValue({ data: { allowed: false, retry_after: until }, error: null });
    expect(await beginLoginAttempt("a@b.c", "203.0.113.7")).toEqual({
      kind: "locked",
      retryAfter: new Date(until),
    });
  });

  // Fail closed: if the limiter can't answer, the caller must not proceed as
  // though the attempt were allowed.
  it("fails, not allows, when the RPC errors", async () => {
    single.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await beginLoginAttempt("a@b.c", null)).kind).toBe("failed");
  });

  it("fails, not allows, when the client throws", async () => {
    rpc.mockImplementation(() => {
      throw new Error("network");
    });
    expect((await beginLoginAttempt("a@b.c", null)).kind).toBe("failed");
  });

  it("fails when refused without an expiry rather than inventing one", async () => {
    single.mockResolvedValue({ data: { allowed: false, retry_after: null }, error: null });
    expect((await beginLoginAttempt("a@b.c", null)).kind).toBe("failed");
  });
});

describe("claimTotpCode", () => {
  beforeEach(() => rpc.mockReset());

  it("distinguishes a first use from a replay", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await claimTotpCode("f", "123456")).toEqual({ kind: "claimed" });
    expect(await claimTotpCode("f", "123456")).toEqual({ kind: "replayed" });
  });

  it("fails, not claims, when the RPC errors or returns no boolean", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await claimTotpCode("f", "123456")).kind).toBe("failed");
    expect((await claimTotpCode("f", "123456")).kind).toBe("failed");
  });
});

describe("lockedOutMessage", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("rounds up to whole minutes", () => {
    expect(lockedOutMessage(new Date("2026-10-16T12:11:01Z"), now)).toBe(
      "Too many sign-in attempts. Try again in 12 minutes.",
    );
  });

  it("never says zero minutes", () => {
    expect(lockedOutMessage(new Date("2026-10-16T12:00:05Z"), now)).toBe(
      "Too many sign-in attempts. Try again in 1 minute.",
    );
  });
});
