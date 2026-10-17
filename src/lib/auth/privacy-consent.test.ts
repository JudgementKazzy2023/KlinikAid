import { describe, expect, it } from "vitest";
import { evaluatePrivacyConsent } from "./privacy-consent";

describe("evaluatePrivacyConsent", () => {
  it("allows a patient who has accepted", () => {
    expect(
      evaluatePrivacyConsent({
        kind: "ok",
        data: { role: "patient", accepted_privacy_at: "2026-10-01T00:00:00Z" },
      })
    ).toEqual({ kind: "ok" });
  });

  it("refuses a patient who has not accepted", () => {
    expect(
      evaluatePrivacyConsent({ kind: "ok", data: { role: "patient", accepted_privacy_at: null } })
    ).toEqual({ kind: "not_accepted" });
  });

  it("does not gate staff, who never see the agreement", () => {
    expect(
      evaluatePrivacyConsent({ kind: "ok", data: { role: "receptionist", accepted_privacy_at: null } })
    ).toEqual({ kind: "ok" });
  });

  it("fails closed when the profile read fails", () => {
    const error = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(evaluatePrivacyConsent({ kind: "failed", error })).toEqual({ kind: "failed", error });
  });

  it("fails closed when there is no profile", () => {
    expect(evaluatePrivacyConsent({ kind: "absent" }).kind).toBe("failed");
    expect(evaluatePrivacyConsent({ kind: "ok", data: null }).kind).toBe("failed");
  });
});
