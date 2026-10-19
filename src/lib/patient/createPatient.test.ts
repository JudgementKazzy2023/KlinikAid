import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPatient } from "./createPatient";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  insert: vi.fn(),
  deletePatient: vi.fn(),
  send: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
    from: () => ({ insert: mocks.insert, delete: () => ({ eq: mocks.deletePatient }) }),
  }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/auth/email-confirmation", () => ({ sendEmailConfirmation: mocks.send }));

const input = {
  email: "patient@example.com", password: "Patient!123", firstName: "Test", lastName: "Patient",
  dob: "1990-01-01", gender: "other", contactNumber: "09000000000", address: "Test address",
} satisfies Parameters<typeof createPatient>[1];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createUser.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "test-patient" }, error: null }) }) });
  mocks.send.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.deletePatient.mockResolvedValue({ error: null });
});

describe("patient creation after email and temporary-password integration", () => {
  it.each([false, true])("requires email confirmation, receptionist=%s", async (receptionist) => {
    const result = await createPatient(createAdminClient(), input, receptionist);
    expect(result.success).toBe(true);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email_confirm: false,
      app_metadata: receptionist ? { role: "patient", must_change_password: true } : { role: "patient" },
    }));
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), input.email);
  });
});

describe("confirmation email failure (PR #92 follow-up)", () => {
  it.each([
    ["rate limit", { code: "over_email_send_rate_limit", status: 429, message: "rate limited" }],
    ["provider outage", { code: "unexpected_failure", status: 500, message: "smtp down" }],
    ["network failure", { status: 0, message: "fetch failed" }],
  ])("keeps the unconfirmed account on a temporary failure (%s)", async (_label, error) => {
    mocks.send.mockResolvedValue({ error });
    const result = await createPatient(createAdminClient(), input, false);
    expect(result).toMatchObject({ success: true, userId: "test-user", patientId: "test-patient", confirmationSent: false });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.deletePatient).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.anything(), "test-user", "USER_REGISTERED", expect.any(String), null, { confirmation_email_sent: false }
    );
  });

  it("reports confirmationSent on a normal registration", async () => {
    const result = await createPatient(createAdminClient(), input, true, "reception-user");
    expect(result).toMatchObject({ success: true, confirmationSent: true });
  });

  it.each(["email_address_invalid", "email_address_not_authorized"])(
    "removes the account when the address is refused (%s)",
    async (code) => {
      mocks.send.mockResolvedValue({ error: { code, status: 400, message: "refused" } });
      const result = await createPatient(createAdminClient(), input, false);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/could not send a confirmation email to this address/);
      expect(mocks.deletePatient).toHaveBeenCalledWith("id", "test-patient");
      expect(mocks.deleteUser).toHaveBeenCalledWith("test-user");
      expect(mocks.logEvent).not.toHaveBeenCalled();
    }
  );

  it("records an incomplete cleanup instead of ignoring it", async () => {
    mocks.send.mockResolvedValue({ error: { code: "email_address_invalid", status: 400, message: "refused" } });
    mocks.deleteUser.mockResolvedValue({ error: { message: "auth unavailable" } });
    const result = await createPatient(createAdminClient(), input, true, "reception-user");
    expect(result.success).toBe(false);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "reception-user",
      "STAFF_ACTION_FAILED",
      expect.stringContaining("cleanup was incomplete"),
      null,
      expect.objectContaining({ target_user_id: "test-user", patient_id: "test-patient", cleanup_error: "auth: auth unavailable" })
    );
  });
});
