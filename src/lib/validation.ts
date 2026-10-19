export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

export const PASSWORD_REQUIREMENT_TEXT =
  "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.";

export function validatePassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}

export function getTodayInPh(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

export const MAX_DOB_AGE_YEARS = 120;

// Shared DOB shape + calendar checks for every surface that collects a date of
// birth: registration, reception New Patient, and the specialist patient form.
// Rejects a malformed date, an impossible date, a future date, and a date more
// than MAX_DOB_AGE_YEARS in the past (Asia/Manila "today"). The 18+ minimum is a
// registration policy and lives in validateAge, not here.
export function validateDobDate(dobString: string): { valid: boolean; error?: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobString);
  if (!match) {
    return { valid: false, error: "Invalid date of birth format." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(Date.UTC(year, month - 1, day));

  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return { valid: false, error: "Invalid date of birth." };
  }

  const today = getTodayInPh();
  const isFuture =
    year > today.year ||
    (year === today.year && month > today.month) ||
    (year === today.year && month === today.month && day > today.day);

  if (isFuture) {
    return { valid: false, error: "Date of birth cannot be in the future." };
  }

  // Lower bound: not more than MAX_DOB_AGE_YEARS years before today. The
  // boundary (exactly MAX_DOB_AGE_YEARS years ago) is accepted.
  const cutoffYear = today.year - MAX_DOB_AGE_YEARS;
  const isTooOld =
    year < cutoffYear ||
    (year === cutoffYear && month < today.month) ||
    (year === cutoffYear && month === today.month && day < today.day);

  if (isTooOld) {
    return {
      valid: false,
      error: `Date of birth cannot be more than ${MAX_DOB_AGE_YEARS} years in the past.`,
    };
  }

  return { valid: true };
}

export function validateAge(dobString: string): { valid: boolean; error?: string } {
  const base = validateDobDate(dobString);
  if (!base.valid) {
    return base;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobString)!;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const today = getTodayInPh();
  let age = today.year - year;
  const hasBirthdayPassed =
    today.month > month || (today.month === month && today.day >= day);

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  if (age < 18) {
    return {
      valid: false,
      error: "Registration is restricted to individuals 18 years old and above.",
    };
  }

  return { valid: true };
}

// Shared name rule — applied to firstName, lastName, and fullName on every form surface.
// Min 2 / Max 100 / Letters (including accented characters) + spaces + hyphens + apostrophes + periods.
export const NAME_REGEX = /^[A-Za-zÀ-ÿ\s\-'\.]+$/;
export const NAME_MIN = 2;
export const NAME_MAX = 100;

// One source of truth for the Zod fallback message on name fields, so a change
// to NAME_MIN cannot leave a form saying a different number than the rule.
export function nameFieldMessage(label: string): string {
  return `${label} must be at least ${NAME_MIN} characters and contain only letters, spaces, hyphens, apostrophes, or periods.`;
}

export function validateName(
  name: string,
  label = "Name"
): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) {
    return {
      valid: false,
      error: `${label} must be at least ${NAME_MIN} characters.`,
    };
  }
  if (trimmed.length > NAME_MAX) {
    return {
      valid: false,
      error: `${label} must be no more than ${NAME_MAX} characters.`,
    };
  }
  if (!NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: `${label} may only contain letters, spaces, hyphens, apostrophes, or periods.`,
    };
  }
  return { valid: true };
}

// Shared contact rule — Philippine mobile only: 09XXXXXXXXX (11 digits).
export const CONTACT_REGEX = /^09\d{9}$/;
export const CONTACT_REQUIREMENT_TEXT =
  "Contact number must be a valid Philippine mobile number (e.g. 09171234567).";

export function validateContactNumber(
  contact: string
): { valid: boolean; error?: string } {
  if (!CONTACT_REGEX.test(contact.trim())) {
    return { valid: false, error: CONTACT_REQUIREMENT_TEXT };
  }
  return { valid: true };
}

// Address: trimmed, required, and bounded. 255 is the standard single-line
// length for a street address and is far more than any real address needs; it
// also bounds the 1,000-character values the QA pass stored.
export const ADDRESS_MAX = 255;
export const ADDRESS_FIELD_MESSAGE = `Address is required and must be no more than ${ADDRESS_MAX} characters.`;

export function validateAddress(
  address: string
): { valid: boolean; error?: string } {
  const trimmed = (address ?? "").trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Address is required." };
  }
  if (trimmed.length > ADDRESS_MAX) {
    return { valid: false, error: `Address must be no more than ${ADDRESS_MAX} characters.` };
  }
  return { valid: true };
}

// Department record notes: a short clinical annotation, not a document. 2000
// characters (~300 words) is generous for a result note while still bounding the
// 5,034-character values the QA pass stored.
export const NOTES_MAX = 2000;

// Rejection reason: feedback to a patient. The minimum already existed as a
// literal 20; it is centralised here with a new upper bound so a long message
// cannot break the patient's Track Submission layout (the UI wraps, and the
// server caps it).
export const REJECTION_REASON_MIN = 20;
export const REJECTION_REASON_MAX = 1000;

export function validateNotes(
  notes: unknown
): { valid: boolean; error?: string } {
  if (notes === null || notes === undefined) return { valid: true };
  if (typeof notes !== "string") return { valid: false, error: "Notes must be text." };
  const trimmed = notes.trim();
  if (trimmed && trimmed.length > NOTES_MAX) {
    return { valid: false, error: `Notes must be no more than ${NOTES_MAX} characters.` };
  }
  return { valid: true };
}

export function validateRejectionReason(
  reason: unknown
): { valid: boolean; error?: string } {
  if (reason !== null && reason !== undefined && typeof reason !== "string") {
    return { valid: false, error: "Rejection reason must be text." };
  }
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < REJECTION_REASON_MIN) {
    return {
      valid: false,
      error: `Rejection reason is required and must be at least ${REJECTION_REASON_MIN} characters long.`,
    };
  }
  if (trimmed.length > REJECTION_REASON_MAX) {
    return {
      valid: false,
      error: `Rejection reason must be no more than ${REJECTION_REASON_MAX} characters long.`,
    };
  }
  return { valid: true };
}
