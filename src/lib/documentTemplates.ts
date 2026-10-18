export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "date" | "textarea" | "select";
  required: boolean;
  options?: string[];
  /** A select whose "No" answer means the patient declined (#62). Not refused: flagged to reception. */
  consent?: boolean;
  /** A date that records something already done (issued, signed), so it cannot be after today. */
  notFuture?: boolean;
}

// Bounds for template answers (#62). Chosen so that no legitimate answer is refused:
// a one-line answer (a name, clinic, procedure) is far under 200 characters, and a
// free-text answer of 2000 characters is a full page. NAME_MAX in validation.ts is
// 100, so 200 also leaves room for "Dr. ..., MD, <clinic>" in a physician field.
export const TEMPLATE_TEXT_MAX_LENGTH = 200;
export const TEMPLATE_TEXTAREA_MAX_LENGTH = 2000;
// Earliest accepted date, and how far ahead a forward-looking date (date needed,
// request date) may be. Both are checked against today in Asia/Manila.
export const TEMPLATE_DATE_MIN = "1900-01-01";
export const TEMPLATE_DATE_MAX_YEARS_AHEAD = 2;

export function templateFieldMaxLength(field: TemplateField): number | null {
  if (field.type === "text") return TEMPLATE_TEXT_MAX_LENGTH;
  if (field.type === "textarea") return TEMPLATE_TEXTAREA_MAX_LENGTH;
  return null;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
}

export const CLINIC_TEMPLATES: DocumentTemplate[] = [
  {
    id: "referral-form",
    name: "Referral Form",
    description: "Submit doctor recommendations and requests for clinic services.",
    fields: [
      { key: "referring_physician", label: "Referring Physician", type: "text", required: true },
      { key: "referring_clinic", label: "Referring Clinic / Hospital", type: "text", required: false },
      { key: "reason_for_referral", label: "Reason for Referral", type: "textarea", required: true },
      { key: "requested_service", label: "Requested Service", type: "select", required: true, options: ["Laboratory", "Imaging", "Ultrasound", "ECG"] },
      { key: "referral_date", label: "Referral Date", type: "date", required: true, notFuture: true }
    ]
  },
  {
    id: "lab-request",
    name: "Laboratory Request",
    description: "Submit request forms for specific blood and urine diagnostic tests.",
    fields: [
      { key: "ordering_physician", label: "Ordering Physician", type: "text", required: true },
      { key: "tests_requested", label: "Tests Requested", type: "textarea", required: true },
      { key: "fasting_required", label: "Fasting Required?", type: "select", required: false, options: ["Yes", "No"] },
      { key: "request_date", label: "Request Date", type: "date", required: true }
    ]
  },
  {
    id: "med-cert",
    name: "Medical Certificate Request",
    description: "Request official health certifications for school or work clearances.",
    fields: [
      { key: "purpose", label: "Purpose of Certificate", type: "textarea", required: true },
      { key: "date_needed", label: "Date Needed", type: "date", required: true }
    ]
  },
  {
    id: "procedure-consent",
    name: "Consent Form",
    description: "Acknowledge and consent to clinical laboratory diagnostic operations.",
    fields: [
      { key: "procedure", label: "Clinical Procedure", type: "text", required: true },
      { key: "consent_given", label: "I Give My Consent?", type: "select", required: true, options: ["Yes", "No"], consent: true },
      { key: "consent_date", label: "Date of Consent", type: "date", required: true, notFuture: true }
    ]
  },
  {
    id: "patient-intake",
    name: "Patient Intake Form",
    description: "Submit basic demographics and complaints before visiting the clinic.",
    fields: [
      // patient_name, date_of_birth, contact_number, address are server-injected from profile (#41)
      { key: "chief_complaint", label: "Chief Health Complaint", type: "textarea", required: true }
    ]
  },
  {
    id: "results-release",
    name: "Results Release Authorization",
    description: "Authorize third-party release or sharing of diagnostic lab results.",
    fields: [
      { key: "release_to", label: "Authorize Release To (Name)", type: "text", required: true },
      { key: "results_type", label: "Clinical Results Authorized for Release", type: "text", required: true },
      { key: "authorization_date", label: "Authorization Date", type: "date", required: true }
    ]
  }
];

