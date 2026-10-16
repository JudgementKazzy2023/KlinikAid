import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "./logger";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));

// A caller client that fails the test if it is ever used to write. The
// failed-login path holds a session-less client, and writing through it is
// what got every LOGIN_FAILED row rejected by RLS (#41).
const callerClient = {
  from: () => {
    throw new Error("logEvent wrote through the caller's client");
  },
} as unknown as SupabaseClient;

describe("logEvent", () => {
  beforeEach(() => {
    insert.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes with the service-role client, not the caller's", async () => {
    insert.mockResolvedValue({ error: null });
    const out = await logEvent(callerClient, null, "LOGIN_FAILED", "bad password", "203.0.113.7");
    expect(out).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      user_id: null,
      event_type: "LOGIN_FAILED",
      description: "bad password",
      ip_address: "203.0.113.7",
      metadata: null,
    });
  });

  it("reports a rejected insert instead of claiming success", async () => {
    const error = { code: "42501", message: "new row violates row-level security policy" };
    insert.mockResolvedValue({ error });
    expect(await logEvent(callerClient, null, "LOGIN_FAILED", "x")).toEqual({ ok: false, error });
  });

  it("reports a thrown failure without rethrowing", async () => {
    insert.mockRejectedValue(new Error("fetch failed"));
    const out = await logEvent(callerClient, null, "LOGIN_FAILED", "x");
    expect(out.ok).toBe(false);
  });
});
