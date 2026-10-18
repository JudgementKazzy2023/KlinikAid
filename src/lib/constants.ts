import { UserRole, Department, DocumentStatus, QueueStatus, ReferenceRangeStatus } from "@/types";

export const USER_ROLES: Record<UserRole, { label: string; color: string }> = {
  admin: { label: "Administrator", color: "bg-red-500 text-white dark:bg-red-600" },
  receptionist: { label: "Receptionist", color: "bg-accentBlue-500 text-white dark:bg-accentBlue-600" },
  department_staff: { label: "Department Staff", color: "bg-purple-500 text-white dark:bg-purple-600" },
  medical_specialist: { label: "Medical Specialist", color: "bg-indigo-500 text-white dark:bg-indigo-600" },
  patient: { label: "Patient", color: "bg-green-500 text-white dark:bg-green-600" },
};

export const DEPARTMENTS: Record<Department, { label: string; color: string; path: string }> = {
  laboratory: { label: "Laboratory", color: "bg-emerald-500 text-white dark:bg-emerald-600", path: "laboratory" },
  imaging: { label: "Imaging (X-Ray)", color: "bg-amber-500 text-white dark:bg-amber-600", path: "imaging" },
  ultrasound: { label: "Ultrasound", color: "bg-teal-500 text-white dark:bg-teal-600", path: "ultrasound" },
  ecg: { label: "ECG", color: "bg-rose-500 text-white dark:bg-rose-600", path: "ecg" },
};

export const DOCUMENT_STATUSES: Record<DocumentStatus, { label: string; color: string }> = {
  pending: { label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export const QUEUE_STATUSES: Record<QueueStatus, { label: string; color: string }> = {
  waiting: { label: "Waiting", color: "bg-accentBlue-100 text-accentBlue-800 dark:bg-accentBlue-900/30 dark:text-accentBlue-400" },
  in_progress: { label: "In Progress", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400" },
};

export const REFERENCE_RANGE_STATUSES: Record<ReferenceRangeStatus, { label: string; color: string }> = {
  normal: { label: "Normal", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  critical_high: { label: "Critical High", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  critical_low: { label: "Critical Low", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  inconclusive: { label: "Inconclusive", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

/**
 * Standard Lab Medical Reference Ranges (Bloodcare Medical Laboratory context)
 * Used to automatically flag out-of-range results in dashboards.
 */
export interface LabReferenceRange {
  parameter: string;
  unit: string;
  /**
   * Plausibility bounds, inclusive. Not clinical thresholds: a value outside
   * the reference range above is abnormal and is saved and flagged, while a
   * value outside these bounds cannot be a real measurement in this unit and is
   * refused. They are set deliberately wide -- past the most extreme values
   * reported in surviving patients -- because refusing a genuine critical
   * result is worse than accepting a typo. Their job is to stop negatives,
   * zeros where zero is impossible, and slipped digits (FBS 99999).
   */
  plausibleMin: number;
  plausibleMax: number;
  maleMin: number;
  maleMax: number;
  femaleMin: number;
  femaleMax: number;
  description: string;
}

export const LAB_REFERENCE_RANGES: LabReferenceRange[] = [
  {
    parameter: "Hemoglobin",
    unit: "g/dL",
    maleMin: 13.5,
    maleMax: 17.5,
    femaleMin: 12.0,
    femaleMax: 15.5,
    plausibleMin: 1,
    plausibleMax: 25,
    description: "Iron-containing oxygen-transport metalloprotein in red blood cells"
  },
  {
    parameter: "White Blood Cells (WBC)",
    unit: "x10^3/µL",
    maleMin: 4.5,
    maleMax: 11.0,
    femaleMin: 4.5,
    femaleMax: 11.0,
    plausibleMin: 0,
    plausibleMax: 1000,
    description: "Cells of the immune system involved in protecting the body"
  },
  {
    parameter: "Platelets",
    unit: "x10^3/µL",
    maleMin: 150,
    maleMax: 450,
    femaleMin: 150,
    femaleMax: 450,
    plausibleMin: 0,
    plausibleMax: 5000,
    description: "Cells that help blood clot"
  },
  {
    parameter: "Fasting Blood Sugar (FBS)",
    unit: "mg/dL",
    maleMin: 70,
    maleMax: 100,
    femaleMin: 70,
    femaleMax: 100,
    plausibleMin: 5,
    plausibleMax: 3000,
    description: "Measures blood glucose after an 8-hour fast"
  },
  {
    parameter: "Creatinine",
    unit: "mg/dL",
    maleMin: 0.6,
    maleMax: 1.2,
    femaleMin: 0.5,
    femaleMax: 1.1,
    plausibleMin: 0.1,
    plausibleMax: 40,
    description: "Waste product filtered by kidneys; indicator of renal function"
  },
  {
    parameter: "Cholesterol",
    unit: "mg/dL",
    maleMin: 100,
    maleMax: 200,
    femaleMin: 100,
    femaleMax: 200,
    plausibleMin: 20,
    plausibleMax: 2000,
    description: "Total lipid marker"
  }
];

export const LAB_TEST_GROUPS = {
  "Complete Blood Count (CBC)": ["Hemoglobin", "White Blood Cells (WBC)", "Platelets"],
  "Fasting Blood Sugar (FBS)": ["Fasting Blood Sugar (FBS)"],
  "Renal Function": ["Creatinine"],
  "Lipid Profile": ["Cholesterol"],
} as const;

export type LabTestPanel = keyof typeof LAB_TEST_GROUPS;
export type LabTestParameter = (typeof LAB_TEST_GROUPS)[LabTestPanel][number];

/**
 * What the entry form and result views call each panel. The keys above are the
 * stored `test_type` and are shared with specialist records, so they stay as
 * they are. Renal Function and Lipid Profile record a single parameter each,
 * and are labelled by that parameter rather than as full panels: no project
 * document establishes ranges for the rest of either panel.
 */
export const LAB_PANEL_LABELS: Record<LabTestPanel, string> = {
  "Complete Blood Count (CBC)": "Complete Blood Count (CBC)",
  "Fasting Blood Sugar (FBS)": "Fasting Blood Sugar (FBS)",
  "Renal Function": "Creatinine",
  "Lipid Profile": "Cholesterol (total)",
};

/**
 * Laboratory tests a patient can request that have no structured panel, because
 * no reference ranges or units are documented for them. They are recorded as
 * narrative text (Findings, optional Impression) and are never flagged
 * automatically. Each name is the stored `test_type`, and none may collide with
 * a key of LAB_TEST_GROUPS.
 */
export const LAB_NARRATIVE_TESTS = [
  "Urinalysis",
  "Fecalysis",
  "Blood Urea Nitrogen (BUN)",
  "SGPT / ALT",
  "SGOT / AST",
  "Lipid Profile (narrative)",
] as const;

export type LabNarrativeTest = (typeof LAB_NARRATIVE_TESTS)[number];

/** The narrative rows a laboratory narrative result consists of. Findings is required. */
export const LAB_NARRATIVE_FIELDS = ["Findings", "Impression"] as const;

export type LabNarrativeField = (typeof LAB_NARRATIVE_FIELDS)[number];

export const LAB_NARRATIVE_MAX_LENGTH = 5000;

/** Display label for a stored test_type: renames lab panels, passes everything else through. */
export function testTypeLabel(department: string, testType: string): string {
  if (department === "laboratory" && Object.prototype.hasOwnProperty.call(LAB_PANEL_LABELS, testType)) {
    return LAB_PANEL_LABELS[testType as LabTestPanel];
  }
  return testType;
}

/**
 * How the department that receives a requested test records it. Laboratory
 * tests name the panel or narrative test_type; the other departments record
 * every test as free-text Findings and Impression.
 */
export type ClinicTestRecording =
  | { department: "laboratory"; panel: LabTestPanel }
  | { department: "laboratory"; narrative: LabNarrativeTest }
  | { department: Exclude<Department, "laboratory"> };

export interface ClinicTestCatalogItem {
  id: string;
  label: string;
  aliases: string[];
  recording: ClinicTestRecording;
}

export const CLINIC_TEST_CATALOG: ClinicTestCatalogItem[] = [
  {
    id: "cbc",
    label: "Complete Blood Count (CBC)",
    aliases: ["cbc", "complete blood count", "hematology", "hemoglobin", "white blood cells", "wbc", "platelets"],
    recording: { department: "laboratory", panel: "Complete Blood Count (CBC)" },
  },
  {
    id: "urinalysis",
    label: "Urinalysis",
    aliases: ["urinalysis", "urine", "urine analysis", "routine urinalysis", "clinical microscopy", "urine test", "ua"],
    recording: { department: "laboratory", narrative: "Urinalysis" },
  },
  {
    id: "fecalysis",
    label: "Fecalysis",
    aliases: ["fecalysis", "routine fecalysis", "stool", "stool exam", "stool examination", "fecal exam"],
    recording: { department: "laboratory", narrative: "Fecalysis" },
  },
  {
    id: "fbs",
    label: "Fasting Blood Sugar (FBS)",
    aliases: ["fbs", "fasting blood sugar", "blood sugar", "fasting glucose", "glucose"],
    recording: { department: "laboratory", panel: "Fasting Blood Sugar (FBS)" },
  },
  {
    id: "lipid_profile",
    label: "Lipid Profile",
    aliases: ["lipid", "lipid profile", "cholesterol", "triglycerides", "hdl", "ldl"],
    // Only total cholesterol has a structured panel; a full lipid profile is narrative.
    recording: { department: "laboratory", narrative: "Lipid Profile (narrative)" },
  },
  {
    id: "creatinine",
    label: "Creatinine",
    aliases: ["creatinine", "serum creatinine", "renal function", "kidney function"],
    recording: { department: "laboratory", panel: "Renal Function" },
  },
  {
    id: "bun",
    label: "Blood Urea Nitrogen (BUN)",
    aliases: ["bun", "blood urea nitrogen", "urea nitrogen"],
    recording: { department: "laboratory", narrative: "Blood Urea Nitrogen (BUN)" },
  },
  {
    id: "sgpt_alt",
    label: "SGPT / ALT",
    aliases: ["sgpt", "alt", "alanine aminotransferase"],
    recording: { department: "laboratory", narrative: "SGPT / ALT" },
  },
  {
    id: "sgot_ast",
    label: "SGOT / AST",
    aliases: ["sgot", "ast", "aspartate aminotransferase"],
    recording: { department: "laboratory", narrative: "SGOT / AST" },
  },
  {
    id: "chest_xray",
    label: "Chest X-ray",
    aliases: ["chest x-ray", "chest xray", "cxr", "x-ray chest", "xray chest", "chest radiograph"],
    recording: { department: "imaging" },
  },
  {
    id: "ecg",
    label: "ECG",
    aliases: ["ecg", "ekg", "electrocardiogram"],
    recording: { department: "ecg" },
  },
  {
    id: "ultrasound",
    label: "Ultrasound",
    aliases: ["ultrasound", "ultrasonography", "utz"],
    recording: { department: "ultrasound" },
  },
];

// Provisional starter guidance only; operator/clinic team should verify against medical references.
export const CLINIC_TEST_PREP_INSTRUCTIONS: Record<string, string> = {
  cbc: "No special preparation needed.",
  urinalysis: "No special preparation needed. Collect a clean midstream sample if instructed.",
  fecalysis: "No special preparation needed.",
  fbs: "Fast for 8 hours before the test. Water is allowed.",
  lipid_profile: "Fast for 9-12 hours before the test. Water is allowed.",
  creatinine: "No special preparation needed.",
  bun: "No special preparation needed.",
  sgpt_alt: "No special preparation needed.",
  sgot_ast: "No special preparation needed.",
  chest_xray: "Remove metal objects and jewelry. Inform staff if you may be pregnant.",
  ecg: "No special preparation needed.",
  ultrasound: "Preparation varies by type - please follow the specific instructions from your clinic.",
};

export const CHART_COLORS = {
  laboratory: '#0D7C66',  // teal — primary brand color
  xray:       '#7C3AED',  // purple
  ultrasound: '#0891B2',  // cyan
  ecg:        '#EA580C',  // orange
  flagged:    '#DC2626',  // red — out-of-range values
  normal:     '#16A34A',  // green — within normal range
  normalBand: '#16A34A',  // green fill for reference area (use with low opacity)
  primary:    '#0D7C66',  // default line/bar color
  muted:      '#94A3B8',  // gray — secondary data
};

// Gemini 2.5 Flash official pricing (Google, May 2026): $0.30/1M input, $2.50/1M output.
// chatbot_logs.tokens_used is the COMBINED total, so a single blended rate is used.
// Blend assumes a RAG workload of ~85% input / ~15% output tokens:
//   0.85 * 0.30 + 0.15 * 2.50 = 0.63 USD per 1M tokens. Edit the blend if the ratio shifts.
export const GEMINI_BLENDED_USD_PER_1M_TOKENS = 0.63;

export const SYSTEM_EVENT_TYPES = {
  LOGIN_SUCCESS:          "LOGIN_SUCCESS",
  LOGIN_FAILED:           "LOGIN_FAILED",
  LOGOUT:                 "LOGOUT",
  USER_REGISTERED:        "USER_REGISTERED",
  PROFILE_PROVISIONING_FAILED: "PROFILE_PROVISIONING_FAILED",
  STAFF_CREATED:          "STAFF_CREATED",
  STAFF_UPDATED:          "STAFF_UPDATED",
  STAFF_ACTIVATED:        "STAFF_ACTIVATED",
  STAFF_DEACTIVATED:      "STAFF_DEACTIVATED",
  DOCUMENT_APPROVED:      "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED:      "DOCUMENT_REJECTED",
  TRIAGE_COMPLETED:       "TRIAGE_COMPLETED",
  RECORD_ENTERED:         "RECORD_ENTERED",
  RAG_DOCUMENT_UPLOADED:  "RAG_DOCUMENT_UPLOADED",
  RAG_DOCUMENT_DELETED:   "RAG_DOCUMENT_DELETED",
  ACCESS_DENIED:          "ACCESS_DENIED",
  EXPORT_SYSTEM_LOGS:     "EXPORT_SYSTEM_LOGS",
  STAFF_ACTION_FAILED:    "STAFF_ACTION_FAILED",
  DOCUMENT_SUBMITTED:     "DOCUMENT_SUBMITTED",
  DOCUMENT_OCR_PROCESSED: "DOCUMENT_OCR_PROCESSED",
  LAB_RESULT_OCR_PROCESSED: "LAB_RESULT_OCR_PROCESSED",
  DEPARTMENT_TEXT_OCR_PROCESSED: "DEPARTMENT_TEXT_OCR_PROCESSED",
  PRIVACY_ACCEPTED:       "PRIVACY_ACCEPTED",
  QUEUE_COMPLETED:        "QUEUE_COMPLETED",
  MFA_ENROLLED:           "MFA_ENROLLED",
  PASSWORD_CHANGED:       "PASSWORD_CHANGED",
  PROFILE_UPDATED:        "PROFILE_UPDATED",
  SPECIALIST_PATIENT_CREATED: "SPECIALIST_PATIENT_CREATED",
  SPECIALIST_PATIENT_DELETED: "SPECIALIST_PATIENT_DELETED",
  SPECIALIST_RECORD_ENTERED: "SPECIALIST_RECORD_ENTERED",
  CUSTOM_ROLE_CREATED:    "CUSTOM_ROLE_CREATED",
  ROLE_UPDATED:           "ROLE_UPDATED",
  ROLE_DELETED:           "ROLE_DELETED",
  ROLE_ASSIGNED:          "ROLE_ASSIGNED",
} as const;

export const WEB_OCR_ENABLED = true;

export const SITE_ORIGIN =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://www.klinikaid.com";


