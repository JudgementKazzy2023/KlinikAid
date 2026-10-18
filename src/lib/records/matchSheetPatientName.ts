/**
 * Does the patient name printed on a lab result sheet name the open patient?
 *
 * Issue #60: OCR autofill used to apply values from whatever sheet was uploaded,
 * so a sheet printed for someone else filled the open patient's form with the
 * normal "OCR suggested N value(s)" notice. This decides whether the sheet's
 * name is the open patient's, and it is deliberately conservative: a false
 * "match" puts another person's results in this patient's chart, while a false
 * "mismatch" only costs the operator one confirmation click.
 *
 * Accepted as the same name, and nothing else:
 * - case, whitespace, punctuation and diacritics ("JOSÉ  dela-cruz" = "Jose Dela Cruz");
 * - "LAST, FIRST" ordering, when the sheet marks it with a comma;
 * - a middle name or middle initial present on one side and missing on the other,
 *   or an initial on one side standing for the full middle name on the other.
 *
 * The first given name and the whole surname must match exactly. There is no
 * similarity scoring, no nickname table and no first-initial matching: each of
 * those can pass a different person, most obviously a sibling who shares the
 * surname.
 */

export type SheetPatientNameMatch =
  /** The sheet's name is the open patient's name under the rules above. */
  | { readonly kind: "match" }
  /** The sheet names someone, and it is not the open patient. */
  | { readonly kind: "mismatch" }
  /** No usable name on one side, so identity cannot be confirmed either way. */
  | { readonly kind: "unconfirmed" };

export interface PatientNameParts {
  first_name: string | null | undefined;
  last_name: string | null | undefined;
}

/**
 * Lowercased ASCII-folded word tokens. Apostrophes join ("O'Neil" = "oneil");
 * every other non-letter, non-digit character separates words.
 */
export function nameTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/** "m" stands for "miguel"; otherwise the two middle tokens must be equal. */
function compatibleMiddle(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * Given names match when the first given name is equal and the middle names
 * are either absent on one side, or the same in number and pairwise compatible.
 */
function givenNamesMatch(recordGiven: string[], sheetGiven: string[]): boolean {
  if (recordGiven.length === 0 || sheetGiven.length === 0) return false;
  if (recordGiven[0] !== sheetGiven[0]) return false;

  const recordMiddle = recordGiven.slice(1);
  const sheetMiddle = sheetGiven.slice(1);
  if (recordMiddle.length === 0 || sheetMiddle.length === 0) return true;
  if (recordMiddle.length !== sheetMiddle.length) return false;
  return recordMiddle.every((token, i) => compatibleMiddle(token, sheetMiddle[i]));
}

/**
 * Split the sheet's name into given names and surname.
 *
 * With a comma, the text before it is the surname ("DELA CRUZ, JUAN M."). Without
 * one, the name is read as "given ... surname", and the surname has to be the
 * record's surname at the end. Comma-less "SURNAME GIVEN" is therefore a
 * mismatch: it is ambiguous, and the safe reading of an ambiguous name is "not
 * confirmed as this patient".
 */
function splitSheetName(
  sheetName: string,
  recordSurname: string[]
): { given: string[]; surname: string[] } | null {
  const commaAt = sheetName.indexOf(",");
  if (commaAt >= 0) {
    return {
      surname: nameTokens(sheetName.slice(0, commaAt)),
      given: nameTokens(sheetName.slice(commaAt + 1)),
    };
  }

  const tokens = nameTokens(sheetName);
  if (tokens.length <= recordSurname.length) return null;
  return {
    given: tokens.slice(0, tokens.length - recordSurname.length),
    surname: tokens.slice(tokens.length - recordSurname.length),
  };
}

export function matchSheetPatientName(
  sheetName: string | null | undefined,
  patient: PatientNameParts
): SheetPatientNameMatch {
  const recordGiven = nameTokens(patient.first_name);
  const recordSurname = nameTokens(patient.last_name);

  if (nameTokens(sheetName).length === 0) return { kind: "unconfirmed" };
  if (recordGiven.length === 0 || recordSurname.length === 0) return { kind: "unconfirmed" };

  const sheet = splitSheetName(sheetName ?? "", recordSurname);
  if (!sheet) return { kind: "mismatch" };

  const matches =
    sameTokens(sheet.surname, recordSurname) && givenNamesMatch(recordGiven, sheet.given);
  return matches ? { kind: "match" } : { kind: "mismatch" };
}
