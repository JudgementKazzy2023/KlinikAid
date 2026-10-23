import type { ClinicTestRecording } from "@/lib/constants";

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
    aliases: [
      "cbc",
      "complete blood count",
      "hematology",
      "hemoglobin",
      "white blood cells",
      "wbc",
      "platelets",
    ],
    recording: {
      department: "laboratory",
      panel: "Complete Blood Count (CBC)",
    },
  },
  {
    id: "urinalysis",
    label: "Urinalysis",
    aliases: [
      "urinalysis",
      "urine",
      "urine analysis",
      "routine urinalysis",
      "clinical microscopy",
      "urine test",
      "ua",
    ],
    recording: { department: "laboratory", narrative: "Urinalysis" },
  },
  {
    id: "fecalysis",
    label: "Fecalysis",
    aliases: [
      "fecalysis",
      "routine fecalysis",
      "stool",
      "stool exam",
      "stool examination",
      "fecal exam",
    ],
    recording: { department: "laboratory", narrative: "Fecalysis" },
  },
  {
    id: "fbs",
    label: "Fasting Blood Sugar (FBS)",
    aliases: [
      "fbs",
      "fasting blood sugar",
      "blood sugar",
      "fasting glucose",
      "glucose",
    ],
    recording: { department: "laboratory", panel: "Fasting Blood Sugar (FBS)" },
  },
  {
    id: "lipid_profile",
    label: "Lipid Profile",
    aliases: [
      "lipid",
      "lipid profile",
      "cholesterol",
      "triglycerides",
      "hdl",
      "ldl",
    ],
    // Only total cholesterol has a structured panel; a full lipid profile is narrative.
    recording: {
      department: "laboratory",
      narrative: "Lipid Profile (narrative)",
    },
  },
  {
    id: "creatinine",
    label: "Creatinine",
    aliases: [
      "creatinine",
      "serum creatinine",
      "renal function",
      "kidney function",
    ],
    recording: { department: "laboratory", panel: "Renal Function" },
  },
  {
    id: "bun",
    label: "Blood Urea Nitrogen (BUN)",
    aliases: ["bun", "blood urea nitrogen", "urea nitrogen"],
    recording: {
      department: "laboratory",
      narrative: "Blood Urea Nitrogen (BUN)",
    },
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
    aliases: [
      "chest x-ray",
      "chest xray",
      "cxr",
      "x-ray chest",
      "xray chest",
      "chest radiograph",
    ],
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
