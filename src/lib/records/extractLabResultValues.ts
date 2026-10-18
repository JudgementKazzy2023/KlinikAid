import { GoogleGenerativeAI } from "@google/generative-ai";
import { LAB_TEST_GROUPS, LabTestPanel, WEB_OCR_ENABLED } from "@/lib/constants";
import { resultValueText } from "@/lib/records/validateLabResult";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;
// The sheet's name and date are model output read off an uploaded image: they
// are shown to the operator and compared, never trusted. Anything longer than a
// plausible name or date is treated as unreadable rather than truncated, since a
// truncated name could compare differently from the one actually printed.
const MAX_SHEET_NAME_LENGTH = 120;
const MAX_SHEET_DATE_LENGTH = 40;
const NO_VALUE_PLACEHOLDERS = new Set(["n/a", "na", "none", "null", "unknown", "not printed", "not available"]);

export interface LabValueExtractionResult {
  panel: LabTestPanel | null;
  values: Partial<Record<(typeof LAB_TEST_GROUPS)[LabTestPanel][number], string>>;
  /** Patient name as printed on the sheet, or null when none is readable. */
  sheetPatientName: string | null;
  /** Collection or report date as printed on the sheet, or null. */
  sheetDate: string | null;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

const LAB_VALUE_EXTRACTION_PROMPT = `You are extracting numeric laboratory result values from a clinic result sheet.
Return ONLY valid JSON. Do not include markdown, explanations, comments, or extra text.

Allowed panels and parameters:
- Complete Blood Count (CBC): Hemoglobin, White Blood Cells (WBC), Platelets
- Fasting Blood Sugar (FBS): Fasting Blood Sugar (FBS)
- Renal Function: Creatinine
- Lipid Profile: Cholesterol

Task:
1. Identify the most likely panel from the allowed list.
2. Extract only numeric result values for allowed parameters.
3. Preserve decimal points. Do not include units. Do not infer missing values.
4. If a value is unclear, missing, unreadable, or ambiguous, omit that parameter.
5. If no allowed lab values are readable, return "panel": null and "values": {}.
6. Copy the patient name exactly as printed on the sheet into "patient_name", keeping its order and punctuation. If no patient name is printed or it is not clearly readable, use null. Never guess or complete a partial name.
7. Copy the specimen collection date, or the report date if no collection date is printed, exactly as printed into "sheet_date". If neither is printed or readable, use null.

Expected JSON shape:
{"patient_name":"DELA CRUZ, JUAN M.","sheet_date":"2026-10-14","panel":"Complete Blood Count (CBC)","values":{"Hemoglobin":"14.2","White Blood Cells (WBC)":"7.1","Platelets":"250"}}`;

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] || trimmed).trim();
}

function isLabTestPanel(value: unknown): value is LabTestPanel {
  return typeof value === "string" && value in LAB_TEST_GROUPS;
}

function sanitizeExtractedValues(panel: LabTestPanel | null, rawValues: unknown) {
  if (!panel || !rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    return {};
  }

  const allowedParams = new Set<string>(LAB_TEST_GROUPS[panel]);
  const sanitized: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(rawValues)) {
    if (!allowedParams.has(key)) continue;

    const value = resultValueText(rawValue)?.trim();
    if (value === undefined || !STRICT_NUMBER_REGEX.test(value)) continue;

    sanitized[key] = value;
  }

  return sanitized;
}

/** Single-line, length-bounded text, or null when absent, a placeholder, or implausibly long. */
function sanitizeSheetText(rawValue: unknown, maxLength: number): string | null {
  if (typeof rawValue !== "string") return null;
  const text = rawValue.replace(/[\p{C}\s]+/gu, " ").trim();
  if (!text || text.length > maxLength) return null;
  if (NO_VALUE_PLACEHOLDERS.has(text.toLowerCase())) return null;
  return text;
}

export async function extractLabResultValues(
  fileBuffer: Buffer,
  mimeType: string
): Promise<LabValueExtractionResult | null> {
  if (!WEB_OCR_ENABLED) {
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      {
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType,
        },
      },
      LAB_VALUE_EXTRACTION_PROMPT,
    ]);

    const usageMetadata = result.response.usageMetadata;
    let responseText = "";

    try {
      responseText = result.response.text() || "";
    } catch (textError) {
      console.error("[extractLabResultValues] Gemini response contained no extractable text:", textError);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(responseText));
    } catch (parseError) {
      console.error("[extractLabResultValues] Failed to parse structured Gemini response:", parseError);
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as { panel?: unknown; values?: unknown; patient_name?: unknown; sheet_date?: unknown };
    const panel = isLabTestPanel(payload.panel) ? payload.panel : null;
    const values = sanitizeExtractedValues(panel, payload.values);

    return {
      panel,
      values,
      sheetPatientName: sanitizeSheetText(payload.patient_name, MAX_SHEET_NAME_LENGTH),
      sheetDate: sanitizeSheetText(payload.sheet_date, MAX_SHEET_DATE_LENGTH),
      promptTokenCount: usageMetadata?.promptTokenCount ?? 0,
      candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? 0,
      totalTokenCount: usageMetadata?.totalTokenCount ?? 0,
    };
  } catch (error) {
    console.error("[extractLabResultValues] Lab value extraction failed:", error);
    return null;
  }
}
