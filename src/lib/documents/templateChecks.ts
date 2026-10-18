import {
  CLINIC_TEMPLATES,
  TEMPLATE_DATE_MAX_YEARS_AHEAD,
  TEMPLATE_DATE_MIN,
  TEMPLATE_TEXTAREA_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
  templateFieldMaxLength,
  type DocumentTemplate,
  type TemplateField,
} from "@/lib/documentTemplates";
import { getTodayInPh } from "@/lib/validation";

/**
 * Checks for template form answers (#62), shared by the submit action and the
 * reception detail page.
 *
 * Reception used to show every template as "100% Validated" as a constant. The
 * submit path checks bounds now, but stored rows predate it, so the detail page
 * re-checks the payload it actually shows instead of trusting how it was written.
 *
 * Pure: `today` (YYYY-MM-DD, Asia/Manila) is a parameter so tests can pin it.
 */

/** Keys the submit action writes itself; they are not patient answers. */
const SUBMISSION_META_KEYS = new Set(["template_id", "template_name", "submission_type", "submitted_at"]);

/** Written from the patient row on intake forms, not typed by the patient. */
const INJECTED_DOB_FIELD: TemplateField = {
  key: "date_of_birth",
  label: "Date of Birth",
  type: "date",
  required: false,
  notFuture: true,
};

const DECLINED_ANSWER = /^(no|n|false|declined?|refused?|i do not consent)$/i;

export function todayInPh(): string {
  const { year, month, day } = getTodayInPh();
  return isoDate(year, month, day);
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function latestTemplateDate(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  return isoDate(year + TEMPLATE_DATE_MAX_YEARS_AHEAD, month, day);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isConsentField(field: Pick<TemplateField, "key" | "consent">): boolean {
  return field.consent === true || /consent/i.test(field.key);
}

/**
 * Why `value` (already trimmed, non-empty) is not an acceptable answer to
 * `field`, as a phrase that follows the field label; null if it is acceptable.
 * Declined consent is acceptable here: a patient may decline.
 */
export function templateFieldProblem(field: TemplateField, value: string, today: string): string | null {
  const maxLength = templateFieldMaxLength(field);
  if (maxLength !== null && value.length > maxLength) {
    return `must be ${maxLength} characters or fewer (has ${value.length})`;
  }

  if (field.type === "date") {
    if (!isValidDateString(value)) return "must be a valid date";
    if (value < TEMPLATE_DATE_MIN) return `must be on or after ${TEMPLATE_DATE_MIN}`;
    if (field.notFuture && value > today) return `cannot be after today (${today})`;
    const latest = latestTemplateDate(today);
    if (value > latest) return `must be on or before ${latest}`;
  }

  if (field.type === "select" && !field.options?.includes(value)) {
    return "must be one of the allowed options";
  }

  return null;
}

export type TemplateSubmissionValidation =
  | { valid: true; fields: Record<string, string> }
  | { valid: false; error: string };

/** Server-side validation of a patient's submitted answers. */
export function validateTemplateSubmission(
  template: DocumentTemplate,
  payload: Record<string, string>,
  today: string = todayInPh()
): TemplateSubmissionValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "Invalid template payload." };
  }

  const allowedKeys = new Set(template.fields.map((field) => field.key));
  const unexpectedKey = Object.keys(payload).find((key) => !allowedKeys.has(key));

  if (unexpectedKey) {
    return { valid: false, error: `Unexpected field submitted: ${unexpectedKey}.` };
  }

  const normalizedFields: Record<string, string> = {};

  for (const field of template.fields) {
    const rawValue = payload[field.key];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (field.required && value === "") {
      return { valid: false, error: `${field.label} is required.` };
    }

    if (value === "") {
      normalizedFields[field.key] = "";
      continue;
    }

    const problem = templateFieldProblem(field, value, today);
    if (problem) {
      return { valid: false, error: `${field.label} ${problem}.` };
    }

    normalizedFields[field.key] = value;
  }

  return { valid: true, fields: normalizedFields };
}

export interface TemplateReviewIssue {
  /** Stored key the issue is about, or null for the form as a whole. */
  field: string | null;
  label: string;
  reason: string;
}

export type TemplateReview =
  | { status: "passed"; checks: string[] }
  | { status: "attention"; issues: TemplateReviewIssue[]; checks: string[] };

function labelForKey(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function declinedIssue(key: string, label: string, value: unknown): TemplateReviewIssue | null {
  if (typeof value !== "string" || !DECLINED_ANSWER.test(value.trim())) return null;
  return { field: key, label, reason: `Patient answered "${value.trim()}": consent was declined.` };
}

/**
 * Re-checks a stored template document's `extracted_metadata` for reception.
 * Never throws: old rows, unknown templates and non-object payloads come back
 * as "attention" with a reason rather than as a crash or a pass.
 */
export function reviewTemplateSubmission(metadata: unknown, today: string = todayInPh()): TemplateReview {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      status: "attention",
      issues: [{ field: null, label: "Form data", reason: "No form answers are stored with this document." }],
      checks: [],
    };
  }

  const stored = metadata as Record<string, unknown>;
  const templateId = typeof stored.template_id === "string" ? stored.template_id : null;
  const template = CLINIC_TEMPLATES.find((item) => item.id === templateId);

  return template ? reviewKnownTemplate(template, stored, today) : reviewUnknownTemplate(templateId, stored, today);
}

function reviewKnownTemplate(
  template: DocumentTemplate,
  stored: Record<string, unknown>,
  today: string
): TemplateReview {
  const issues: TemplateReviewIssue[] = [];
  const fields =
    template.id === "patient-intake" && stored.date_of_birth ? [...template.fields, INJECTED_DOB_FIELD] : template.fields;

  for (const field of fields) {
    const raw = stored[field.key];

    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      if (field.required) issues.push({ field: field.key, label: field.label, reason: "Required answer is missing." });
      continue;
    }

    if (typeof raw !== "string") {
      issues.push({ field: field.key, label: field.label, reason: "Stored answer is not text." });
      continue;
    }

    const problem = templateFieldProblem(field, raw.trim(), today);
    if (problem) {
      issues.push({ field: field.key, label: field.label, reason: `${capitalize(problem)}.` });
      continue;
    }

    if (isConsentField(field)) {
      const declined = declinedIssue(field.key, field.label, raw);
      if (declined) issues.push(declined);
    }
  }

  const dateFields = fields.filter((field) => field.type === "date");
  const pastOnlyLabels = dateFields.filter((field) => field.notFuture).map((field) => field.label);
  const checks = [
    "Required answers present",
    `Text within ${TEMPLATE_TEXT_MAX_LENGTH} characters, long answers within ${TEMPLATE_TEXTAREA_MAX_LENGTH}`,
    ...(dateFields.length > 0
      ? [`Dates valid, from ${TEMPLATE_DATE_MIN} to at most ${TEMPLATE_DATE_MAX_YEARS_AHEAD} years ahead`]
      : []),
    ...(pastOnlyLabels.length > 0 ? [`${pastOnlyLabels.join(", ")} not after today`] : []),
    ...(fields.some((field) => field.type === "select") ? ["Choices are allowed options"] : []),
    ...(fields.some(isConsentField) ? ["Consent was given"] : []),
  ];

  return issues.length > 0 ? { status: "attention", issues, checks } : { status: "passed", checks };
}

function reviewUnknownTemplate(
  templateId: string | null,
  stored: Record<string, unknown>,
  today: string
): TemplateReview {
  const issues: TemplateReviewIssue[] = [
    {
      field: null,
      label: "Form template",
      reason: templateId
        ? `"${templateId}" is not a current clinic form, so its answers could not be checked against one.`
        : "This document does not record which clinic form it came from, so its answers could not be checked against one.",
    },
  ];

  // Without a schema, apply the bounds every form shares to whatever was stored.
  for (const [key, raw] of Object.entries(stored)) {
    if (SUBMISSION_META_KEYS.has(key) || typeof raw !== "string") continue;
    const label = labelForKey(key);
    const value = raw.trim();

    if (value.length > TEMPLATE_TEXTAREA_MAX_LENGTH) {
      issues.push({ field: key, label, reason: `Must be ${TEMPLATE_TEXTAREA_MAX_LENGTH} characters or fewer (has ${value.length}).` });
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const problem = templateFieldProblem({ key, label, type: "date", required: false }, value, today);
      if (problem) issues.push({ field: key, label, reason: `${capitalize(problem)}.` });
    }

    if (isConsentField({ key })) {
      const declined = declinedIssue(key, label, raw);
      if (declined) issues.push(declined);
    }
  }

  return { status: "attention", issues, checks: [] };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
