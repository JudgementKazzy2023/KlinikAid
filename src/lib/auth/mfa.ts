export type MfaFactor = {
  id: string;
  status?: string;
  factor_type?: string;
};

type MfaFactorsResponse = {
  all?: MfaFactor[];
  totp?: MfaFactor[];
  phone?: MfaFactor[];
};

export function getTotpFactors(factors: MfaFactorsResponse | null | undefined): MfaFactor[] {
  const directTotp = Array.isArray(factors?.totp) ? factors.totp : [];
  const allTotp = Array.isArray(factors?.all)
    ? factors.all.filter((factor) => factor.factor_type === "totp")
    : [];
  const byId = new Map<string, MfaFactor>();

  for (const factor of [...directTotp, ...allTotp]) {
    byId.set(factor.id, factor);
  }

  return Array.from(byId.values());
}

export function getPhoneFactors(factors: MfaFactorsResponse | null | undefined): MfaFactor[] {
  return Array.isArray(factors?.phone) ? factors.phone : [];
}

/**
 * Finds the caller's TOTP factor with this id, whatever its status.
 *
 * `listFactors` only returns the caller's own factors, so an id match is the
 * ownership proof. Status must not be part of the match: during enrolment the
 * factor is `unverified` until `mfa.verify` succeeds, and it only appears in
 * `all` (supabase-js puts verified factors alone in `totp`).
 */
export function findOwnedTotpFactor(
  factors: MfaFactorsResponse | null | undefined,
  factorId: string,
): MfaFactor | undefined {
  return getTotpFactors(factors).find((factor) => factor.id === factorId);
}
