import { describe, expect, it } from "vitest";
import { CLINIC_TEMPLATES, type DocumentTemplate } from "@/lib/documentTemplates";
import {
  latestTemplateDate,
  reviewTemplateSubmission,
  templateDocument,
  templateRequestFingerprint,
  validateTemplateSubmission,
} from "./templateChecks";

/**
 * Issue #62: reception showed every template as "100% Validated", including a
 * declined consent and a referral dated 1800 with 10,000 characters of junk,
 * and the submit path had no length or date bounds. These tests pin both.
 */

const TODAY = "2026-10-18";

function template(id: string): DocumentTemplate {
  const found = CLINIC_TEMPLATES.find((item) => item.id === id);
  if (!found) throw new Error(`no template ${id}`);
  return found;
}

/** Shape the submit action writes to documents.extracted_metadata. */
function storedRow(templateId: string, answers: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    ...answers,
    patient_name: "Juan Dela Cruz",
    ...extra,
    template_id: templateId,
    template_name: template(templateId).name,
    submission_type: "template",
    submitted_at: "2026-10-18T01:00:00.000Z",
  };
}

const VALID_REFERRAL = {
  referring_physician: "Dr. Maria Santos",
  referring_clinic: "",
  reason_for_referral: "Persistent fatigue; CBC requested.",
  requested_service: "Laboratory",
  referral_date: "2026-10-15",
};

const VALID_CONSENT = { procedure: "Venipuncture", consent_given: "Yes", consent_date: TODAY };

function issueFor(review: ReturnType<typeof reviewTemplateSubmission>, field: string | null) {
  expect(review.status).toBe("attention");
  if (review.status !== "attention") throw new Error("unreachable");
  return review.issues.find((issue) => issue.field === field);
}

describe("validateTemplateSubmission", () => {
  it("accepts a complete, in-range form", () => {
    const result = validateTemplateSubmission(template("referral-form"), VALID_REFERRAL, TODAY);
    expect(result).toEqual({ valid: true, fields: VALID_REFERRAL });
  });

  it("accepts a declined consent: a patient may decline", () => {
    const result = validateTemplateSubmission(
      template("procedure-consent"),
      { ...VALID_CONSENT, consent_given: "No" },
      TODAY
    );
    expect(result.valid).toBe(true);
  });

  it("refuses a 1800 date, naming the field", () => {
    const result = validateTemplateSubmission(
      template("referral-form"),
      { ...VALID_REFERRAL, referral_date: "1800-01-01" },
      TODAY
    );
    expect(result).toEqual({ valid: false, error: "Referral Date must be on or after 1900-01-01." });
  });

  it("accepts 1900-01-01 itself", () => {
    const result = validateTemplateSubmission(
      template("referral-form"),
      { ...VALID_REFERRAL, referral_date: "1900-01-01" },
      TODAY
    );
    expect(result.valid).toBe(true);
  });

  it("refuses a past-only date that is after today, and accepts today", () => {
    const future = validateTemplateSubmission(
      template("procedure-consent"),
      { ...VALID_CONSENT, consent_date: "2026-10-19" },
      TODAY
    );
    expect(future).toEqual({ valid: false, error: "Date of Consent cannot be after today (2026-10-18)." });

    const today = validateTemplateSubmission(template("procedure-consent"), VALID_CONSENT, TODAY);
    expect(today.valid).toBe(true);
  });

  it("accepts a forward-looking date within the window and refuses one beyond it", () => {
    const medCert = template("med-cert");
    expect(validateTemplateSubmission(medCert, { purpose: "Work clearance", date_needed: "2026-12-01" }, TODAY).valid).toBe(true);
    expect(validateTemplateSubmission(medCert, { purpose: "Work clearance", date_needed: "9999-12-31" }, TODAY)).toEqual({
      valid: false,
      error: `Date Needed must be on or before ${latestTemplateDate(TODAY)}.`,
    });
  });

  it("refuses an over-length field, naming it, and accepts one at the limit", () => {
    const over = validateTemplateSubmission(
      template("referral-form"),
      { ...VALID_REFERRAL, reason_for_referral: "x".repeat(10_034) },
      TODAY
    );
    expect(over).toEqual({
      valid: false,
      error: "Reason for Referral must be 2000 characters or fewer (has 10034).",
    });

    const atTextLimit = validateTemplateSubmission(
      template("referral-form"),
      { ...VALID_REFERRAL, referring_physician: "x".repeat(200) },
      TODAY
    );
    expect(atTextLimit.valid).toBe(true);

    const overTextLimit = validateTemplateSubmission(
      template("referral-form"),
      { ...VALID_REFERRAL, referring_physician: "x".repeat(201) },
      TODAY
    );
    expect(overTextLimit).toEqual({ valid: false, error: "Referring Physician must be 200 characters or fewer (has 201)." });
  });

  it("still refuses missing required answers, bad options and unexpected keys", () => {
    const referral = template("referral-form");
    expect(validateTemplateSubmission(referral, { ...VALID_REFERRAL, referring_physician: "  " }, TODAY)).toEqual({
      valid: false,
      error: "Referring Physician is required.",
    });
    expect(validateTemplateSubmission(referral, { ...VALID_REFERRAL, requested_service: "MRI" }, TODAY)).toEqual({
      valid: false,
      error: "Requested Service must be one of the allowed options.",
    });
    expect(validateTemplateSubmission(referral, { ...VALID_REFERRAL, patient_name: "x" }, TODAY)).toEqual({
      valid: false,
      error: "Unexpected field submitted: patient_name.",
    });
  });
});

describe("reviewTemplateSubmission", () => {
  it("passes a complete, valid form and says what was checked", () => {
    const review = reviewTemplateSubmission(storedRow("procedure-consent", VALID_CONSENT), TODAY);
    expect(review.status).toBe("passed");
    expect(review.checks).toContain("Consent was given");
    expect(review.checks.join(" ")).not.toMatch(/100%/);
  });

  it("passes a valid referral, ignoring keys reception adds on approval", () => {
    const review = reviewTemplateSubmission(
      storedRow("referral-form", VALID_REFERRAL, { reviewed_by_name: "Staff", review_notes: "ok" }),
      TODAY
    );
    expect(review.status).toBe("passed");
  });

  it("flags an undeclared stored answer on a known form instead of passing it", () => {
    const review = reviewTemplateSubmission(
      storedRow("referral-form", VALID_REFERRAL, { extra_note: "anything" }),
      TODAY
    );
    expect(review.status).toBe("attention");
    expect(issueFor(review, "extra_note")?.reason).toMatch(/not a question on this form/i);
  });

  it("flags an intake-only identity key stored on a non-intake form", () => {
    const review = reviewTemplateSubmission(
      storedRow("referral-form", VALID_REFERRAL, { address: "anything" }),
      TODAY
    );
    expect(review.status).toBe("attention");
    expect(issueFor(review, "address")?.reason).toMatch(/not a question on this form/i);
  });

  it("flags a declined consent, naming the consent field", () => {
    const review = reviewTemplateSubmission(
      storedRow("procedure-consent", { ...VALID_CONSENT, consent_given: "No" }),
      TODAY
    );
    expect(issueFor(review, "consent_given")).toEqual({
      field: "consent_given",
      label: "I Give My Consent?",
      reason: 'Patient answered "No": consent was declined.',
    });
  });

  it("flags an old row dated 1800", () => {
    const review = reviewTemplateSubmission(
      storedRow("referral-form", { ...VALID_REFERRAL, referral_date: "1800-01-01" }),
      TODAY
    );
    expect(issueFor(review, "referral_date")?.reason).toBe("Must be on or after 1900-01-01.");
  });

  it("flags a future date of birth injected on an intake form", () => {
    const review = reviewTemplateSubmission(
      storedRow("patient-intake", { chief_complaint: "Headache" }, { date_of_birth: "2030-01-01", contact_number: "", address: "" }),
      TODAY
    );
    expect(issueFor(review, "date_of_birth")?.reason).toBe("Cannot be after today (2026-10-18).");
  });

  it("flags an old row with an over-length answer", () => {
    const review = reviewTemplateSubmission(
      storedRow("referral-form", { ...VALID_REFERRAL, reason_for_referral: "junk ".repeat(2000) }),
      TODAY
    );
    expect(issueFor(review, "reason_for_referral")?.reason).toMatch(/^Must be 2000 characters or fewer/);
  });

  it("flags a missing required answer and a non-text answer without throwing", () => {
    const review = reviewTemplateSubmission(
      { template_id: "procedure-consent", procedure: 42, consent_date: TODAY },
      TODAY
    );
    expect(issueFor(review, "procedure")?.reason).toBe("Stored answer is not text.");
    expect(issueFor(review, "consent_given")?.reason).toBe("Required answer is missing.");
  });

  it("flags an unknown or missing template id, and still checks shared bounds", () => {
    const unknown = reviewTemplateSubmission(
      { template_id: "legacy-consent", patient_consent: "Declined", signed_on: "1800-01-01", notes: "y".repeat(5000) },
      TODAY
    );
    expect(issueFor(unknown, null)?.reason).toContain('"legacy-consent" is not a current clinic form');
    expect(issueFor(unknown, "patient_consent")?.reason).toContain("consent was declined");
    expect(issueFor(unknown, "signed_on")?.reason).toBe("Must be on or after 1900-01-01.");
    expect(issueFor(unknown, "notes")?.reason).toMatch(/^Must be 2000 characters or fewer/);

    const missing = reviewTemplateSubmission({ procedure: "x" }, TODAY);
    expect(issueFor(missing, null)?.reason).toContain("does not record which clinic form");
  });

  it.each([[null], [undefined], ["text"], [[1, 2]]])("returns attention, not a crash, for metadata %j", (metadata) => {
    expect(reviewTemplateSubmission(metadata, TODAY).status).toBe("attention");
  });
});

describe("templateDocument and templateRequestFingerprint (migration_41 submit paths)", () => {
  const patient = {
    first_name: "Juan",
    last_name: "Dela Cruz",
    date_of_birth: "1990-01-01",
    contact_number: "09171234567",
    address: "Manila",
  };
  const now = new Date("2026-10-18T01:00:00.000Z");

  it("writes the stored shape reception reviews, with intake identity only on intake", () => {
    const referral = templateDocument(template("referral-form"), VALID_REFERRAL, patient, now);
    expect(referral.file_path).toBe(`template://referral-form-${now.getTime()}`);
    expect(referral.extracted_metadata).toEqual(storedRow("referral-form", VALID_REFERRAL));
    expect(reviewTemplateSubmission(referral.extracted_metadata, TODAY).status).toBe("passed");

    const intake = templateDocument(template("patient-intake"), { chief_complaint: "Cough" }, patient, now);
    expect(intake.extracted_metadata).toMatchObject({ date_of_birth: "1990-01-01", address: "Manila" });
  });

  it("fingerprints answers independent of key order, and differs when an answer does", async () => {
    const reordered = Object.fromEntries(Object.entries(VALID_REFERRAL).reverse());
    const base = await templateRequestFingerprint("referral-form", VALID_REFERRAL);
    expect(await templateRequestFingerprint("referral-form", reordered)).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await templateRequestFingerprint("referral-form", { ...VALID_REFERRAL, referring_clinic: "X" })).not.toBe(base);
    expect(await templateRequestFingerprint("lab-request", VALID_REFERRAL)).not.toBe(base);
  });
});
