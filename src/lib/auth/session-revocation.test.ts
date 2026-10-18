import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { banAuthUser, liftAuthBan, revokeAllSessions } from "./session-revocation";

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { verifyOtp } }),
}));

const getUserById = vi.fn();
const generateLink = vi.fn();
const signOut = vi.fn();
const updateUserById = vi.fn();
const adminClient = {
  auth: { admin: { getUserById, generateLink, signOut, updateUserById } },
} as unknown as SupabaseClient;

const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("revokeAllSessions", () => {
  beforeEach(() => {
    getUserById.mockReset().mockResolvedValue({ data: { user: { email: "s@example.com" } }, error: null });
    generateLink.mockReset().mockResolvedValue({ data: { properties: { hashed_token: "hash" } }, error: null });
    verifyOtp.mockReset().mockResolvedValue({ data: { session: { access_token: "minted" } }, error: null });
    signOut.mockReset().mockResolvedValue({ data: null, error: null });
  });

  // Global scope is the whole point: local scope would end only the
  // temporary session and leave the user's own sessions alive.
  it("signs the temporary session out with global scope", async () => {
    expect(await revokeAllSessions(adminClient, USER_ID)).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "s@example.com" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "magiclink" });
    expect(signOut).toHaveBeenCalledWith("minted", "global");
  });

  it("fails when the user cannot be looked up", async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: new Error("User not found") });
    expect(await revokeAllSessions(adminClient, USER_ID)).toEqual({ ok: false, error: "User not found" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("fails when the user has no email", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: undefined } }, error: null });
    expect((await revokeAllSessions(adminClient, USER_ID)).ok).toBe(false);
  });

  // A banned user cannot be issued the temporary session.
  it("fails when the token exchange is refused", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error("User is banned") });
    expect(await revokeAllSessions(adminClient, USER_ID)).toEqual({ ok: false, error: "User is banned" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("fails when sign-out is refused", async () => {
    signOut.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    expect(await revokeAllSessions(adminClient, USER_ID)).toEqual({ ok: false, error: "invalid JWT" });
  });

  it("reports a thrown error instead of throwing", async () => {
    generateLink.mockRejectedValue(new Error("network"));
    expect(await revokeAllSessions(adminClient, USER_ID)).toEqual({ ok: false, error: "network" });
  });
});

describe("banAuthUser / liftAuthBan", () => {
  beforeEach(() => {
    updateUserById.mockReset().mockResolvedValue({ data: { user: {} }, error: null });
  });

  it("bans until lifted and lifts with 'none'", async () => {
    expect(await banAuthUser(adminClient, USER_ID)).toEqual({ ok: true });
    expect(updateUserById).toHaveBeenLastCalledWith(USER_ID, { ban_duration: "876000h" });
    expect(await liftAuthBan(adminClient, USER_ID)).toEqual({ ok: true });
    expect(updateUserById).toHaveBeenLastCalledWith(USER_ID, { ban_duration: "none" });
  });

  it("reports an Auth error", async () => {
    updateUserById.mockResolvedValue({ data: { user: null }, error: new Error("boom") });
    expect(await banAuthUser(adminClient, USER_ID)).toEqual({ ok: false, error: "boom" });
    expect(await liftAuthBan(adminClient, USER_ID)).toEqual({ ok: false, error: "boom" });
  });
});
