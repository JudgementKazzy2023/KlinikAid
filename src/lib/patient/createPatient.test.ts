import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPatient } from "./createPatient";

const mocks = vi.hoisted(() => ({ createUser: vi.fn(), insert: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: mocks.createUser } },
    from: () => ({ insert: mocks.insert }),
  }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: vi.fn() }));
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
