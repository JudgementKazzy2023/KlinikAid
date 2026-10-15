import { describe, expect, it } from "vitest";
import { findOwnedTotpFactor } from "./mfa";

/**
 * Shapes follow supabase-js `listFactors`: every factor goes in `all`, but only
 * verified ones are copied into `totp`/`phone`. A factor mid-enrolment is
 * therefore visible in `all` alone.
 */
const UNVERIFIED = { id: "81f066f7", status: "unverified", factor_type: "totp" };
const VERIFIED = { id: "a1b2c3d4", status: "verified", factor_type: "totp" };

describe("findOwnedTotpFactor", () => {
  it("finds a factor still being enrolled (unverified, listed only in `all`)", () => {
    const factors = { all: [UNVERIFIED], totp: [], phone: [] };
    expect(findOwnedTotpFactor(factors, UNVERIFIED.id)).toEqual(UNVERIFIED);
  });

  it("finds an already-verified factor", () => {
    const factors = { all: [VERIFIED], totp: [VERIFIED], phone: [] };
    expect(findOwnedTotpFactor(factors, VERIFIED.id)).toEqual(VERIFIED);
  });

  it("rejects an id that is not among the caller's factors", () => {
    const factors = { all: [UNVERIFIED, VERIFIED], totp: [VERIFIED], phone: [] };
    expect(findOwnedTotpFactor(factors, "someone-elses-factor")).toBeUndefined();
  });

  it("rejects a non-TOTP factor with a matching id", () => {
    const phone = { id: "p1", status: "unverified", factor_type: "phone" };
    expect(findOwnedTotpFactor({ all: [phone], totp: [], phone: [] }, phone.id)).toBeUndefined();
  });

  it("returns undefined when no factors are available", () => {
    expect(findOwnedTotpFactor(null, UNVERIFIED.id)).toBeUndefined();
  });
});
