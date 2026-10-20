import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Route-level regression coverage for the blood-pressure rule from issue #126:
// an impossible reading must be refused with a 400 *before* the triage_patient
// RPC runs, so the shared validator in src/lib/validation.ts is not the only
// thing standing between a typo and a queue entry.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), requirePermission: vi.fn(), rpc: vi.fn(), logEvent: vi.fn(),
}));
vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/logger", () => ({ logEvent: mocks.logEvent }));

const triage = (bloodPressure: unknown) => POST(new Request("http://test/api/reception/triage", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    patient_id: "00000000-0000-0000-0000-000000000001",
    department: "laboratory",
    vitals: { blood_pressure: bloodPressure },
  }),
}));

describe("reception triage blood-pressure validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.requirePermission.mockResolvedValue({ full_name: "Reception" });
    mocks.logEvent.mockResolvedValue(undefined);
  });

  it("answers 400 and never reaches the queue write for an impossible reading", async () => {
    const response = await triage("999/999");
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("Systolic must be 40-300");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("answers 400 when the diastolic is not below the systolic", async () => {
    const response = await triage("120/120");
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("higher than diastolic");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed reading", async () => {
    const response = await triage("abc");
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("120/80");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("routes a patient with a valid reading", async () => {
    const queueEntry = {
      id: 7,
      triage_notes: JSON.stringify({
        queue_number: "LAB-001",
        vitals: { blood_pressure: "120/80", weight_kg: null, temperature_c: null },
        notes: "",
      }),
      patient: { id: "00000000-0000-0000-0000-000000000001", first_name: "Test", last_name: "Patient" },
    };
    mocks.rpc.mockReturnValue({ select: () => ({ single: async () => ({ data: queueEntry, error: null }) }) });

    const response = await triage("120/80");
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("triage_patient", expect.objectContaining({
      p_vitals: expect.objectContaining({ blood_pressure: "120/80" }),
    }));
    const body = await response.json();
    expect(body.data.queue_number).toBe("LAB-001");
  });

  it("keeps a blank optional reading blank", async () => {
    const queueEntry = {
      id: 8,
      triage_notes: JSON.stringify({ queue_number: "LAB-002", vitals: { blood_pressure: null }, notes: "" }),
      patient: { id: "00000000-0000-0000-0000-000000000001", first_name: "Test", last_name: "Patient" },
    };
    mocks.rpc.mockReturnValue({ select: () => ({ single: async () => ({ data: queueEntry, error: null }) }) });

    const response = await triage(null);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("triage_patient", expect.objectContaining({
      p_vitals: expect.objectContaining({ blood_pressure: null }),
    }));
  });
});
