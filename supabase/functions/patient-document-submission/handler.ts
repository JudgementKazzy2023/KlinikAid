// Shared with the web app: the same files src/app/(dashboard)/patient/templates
// imports, mapped by deno.json. Never copy them into this folder.
import { CLINIC_TEMPLATES } from "@/lib/documentTemplates";
import {
  templateDocument,
  templateRequestFingerprint,
  todayInPh,
  validateTemplateSubmission,
} from "@/lib/documents/templateChecks";
import { validateAge, validateDobDate } from "@/lib/validation";

export const statuses = {
  UNAUTHENTICATED: 401,
  METHOD_NOT_ALLOWED: 405,
  SERVER_DATA_INVALID: 500,
  PATIENT_ACCOUNT_REQUIRED: 403,
  NO_PATIENT_RECORD: 403,
  PROFILE_INACTIVE: 403,
  EMAIL_NOT_CONFIRMED: 403,
  CONSENT_REQUIRED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  UNKNOWN_TEMPLATE: 400,
  UNKNOWN_FIELD: 400,
  FIELD_REQUIRED: 400,
  FIELD_INVALID: 400,
  AGE_REQUIREMENT_NOT_MET: 403,
  DUPLICATE_PENDING: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RECONCILIATION_REQUIRED: 409,
  SERVER_ERROR: 503,
} as const;
export type Code = keyof typeof statuses;
export class SubmissionError extends Error {
  constructor(
    public code: Code,
    public field?: string,
    public extra?: Record<string, string>,
  ) {
    super(code);
  }
}
export type User = {
  id: string;
  email_confirmed_at?: string;
  app_metadata: { must_change_password?: unknown };
};
export type Profile = {
  role: string;
  is_active: boolean;
  accepted_privacy_at: string | null;
};
// Same rule as sync_profile_legacy_role(): a system role is its name, a
// custom role its base_role; no role (role_id null) is no patient.
export function resolvedRole(
  role: { name: string; is_system: boolean; base_role: string | null } | null,
): string {
  if (!role) return "";
  return role.is_system ? role.name : role.base_role ?? "";
}
export type Patient = {
  id: string;
  profile_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  contact_number: string | null;
  address: string | null;
};
export interface Identity {
  // Must validate with Auth.getUser(token), never decode/trust JWT claims alone.
  authenticate(token: string): Promise<User | null>;
  // Errors must throw; absent rows return null. Never mask failed reads as absence.
  profile(userId: string): Promise<Profile | null>;
  patientByProfile(userId: string): Promise<Patient | null>;
}
export type TemplateSubmission = {
  user_id: string;
  request_id: string;
  fingerprint: string;
  patient_id: string;
  file_name: string;
  file_path: string;
  metadata: Record<string, string>;
  description: string;
};
export type Outcome =
  | { outcome: "created" | "replayed"; document_id: string }
  | { outcome: "duplicate"; document_id: string; status: string }
  | { outcome: "conflict" | "expired" | "withdrawn" };
export interface SubmissionStore {
  // One database transaction: public.submit_patient_template (migration_41).
  // Receipt check, duplicate rule, document, DOCUMENT_SUBMITTED event and
  // receipt commit or roll back together. Failures throw.
  submitTemplate(input: TemplateSubmission): Promise<Outcome>;
  // public.submit_patient_template_outcome (migration_41): reads only, scoped
  // to the caller, waits for an in-flight submit of the same request.
  lookupTemplate(userId: string, requestId: string): Promise<Lookup>;
}
export type Lookup =
  | {
    state: "committed";
    document_id: string;
    status: string;
    first_accepted_at: string;
    replayable: boolean;
  }
  | { state: "withdrawn"; first_accepted_at: string }
  | { state: "not_found" };
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(
  body: object,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messages: Record<Code, string> = {
  METHOD_NOT_ALLOWED: "Use POST or OPTIONS.",
  SERVER_DATA_INVALID:
    "Account information needs correction. Please contact the clinic. Do not retry until corrected.",
  PATIENT_ACCOUNT_REQUIRED: "A patient account is required.",
  UNAUTHENTICATED: "Please sign in again.",
  NO_PATIENT_RECORD: "Patient account is incomplete. Contact the clinic.",
  PROFILE_INACTIVE: "Account is inactive or unavailable. Contact the clinic.",
  EMAIL_NOT_CONFIRMED: "Please verify your email.",
  CONSENT_REQUIRED: "Please accept the privacy agreement.",
  PASSWORD_CHANGE_REQUIRED: "Please change your temporary password.",
  UNKNOWN_TEMPLATE: "This template is not supported.",
  UNKNOWN_FIELD: "The request contains an unsupported field.",
  FIELD_REQUIRED: "A required field is empty.",
  FIELD_INVALID: "A field has an invalid value.",
  AGE_REQUIREMENT_NOT_MET:
    "Patient intake requires a valid date of birth and age 18 or above.",
  DUPLICATE_PENDING: "A matching submission is already pending.",
  IDEMPOTENCY_CONFLICT:
    "This request ID belongs to different content. Reconciliation is required.",
  RECONCILIATION_REQUIRED:
    "This request can no longer be retried. Contact the clinic before submitting again.",
  SERVER_ERROR:
    "Submission could not be confirmed. Retain the request ID for reconciliation.",
};

export function createHandler(
  deps: { identity: Identity; store?: SubmissionStore; now?: () => Date },
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return reply(
        {
          error_code: "METHOD_NOT_ALLOWED",
          message: messages.METHOD_NOT_ALLOWED,
        },
        405,
        { Allow: "POST, OPTIONS" },
      );
    }
    try {
      const token = /^Bearer\s+(\S+)$/i.exec(
        req.headers.get("authorization") ?? "",
      )?.[1];
      if (!token) throw new SubmissionError("UNAUTHENTICATED");
      const user = await deps.identity.authenticate(token);
      if (!user) throw new SubmissionError("UNAUTHENTICATED");
      const profile = await deps.identity.profile(user.id);
      if (!profile?.is_active) throw new SubmissionError("PROFILE_INACTIVE");
      if (profile.role !== "patient") {
        throw new SubmissionError("PATIENT_ACCOUNT_REQUIRED");
      }
      const patient = await deps.identity.patientByProfile(user.id);
      if (!patient) throw new SubmissionError("NO_PATIENT_RECORD");
      // Assertion is about the lookup relationship, not UUID inequality:
      // coincidentally equal UUIDs are possible, but must never be substituted.
      if (!patient.id || patient.profile_id !== user.id) {
        throw new SubmissionError("SERVER_ERROR");
      }
      if (!user.email_confirmed_at) {
        throw new SubmissionError("EMAIL_NOT_CONFIRMED");
      }
      if (!profile.accepted_privacy_at) {
        throw new SubmissionError("CONSENT_REQUIRED");
      }
      if (user.app_metadata.must_change_password === true) {
        throw new SubmissionError("PASSWORD_CHANGE_REQUIRED");
      }

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new SubmissionError("FIELD_INVALID", "body");
      }
      if (!isObject(raw)) throw new SubmissionError("FIELD_INVALID", "body");
      // POST .../patient-document-submission/status: outcome lookup, same gates.
      const isStatus = new URL(req.url).pathname.endsWith("/status");
      const allowed = isStatus
        ? ["request_id"]
        : ["request_id", "template_id", "fields"];
      const unknown = Object.keys(raw).find((k) => !allowed.includes(k));
      // Never echo arbitrary user-provided key names (they may contain PII).
      if (unknown) throw new SubmissionError("UNKNOWN_FIELD", "body");
      if (typeof raw.request_id !== "string" || !uuid.test(raw.request_id)) {
        throw new SubmissionError("FIELD_INVALID", "request_id");
      }
      if (isStatus) {
        if (!deps.store) throw new SubmissionError("SERVER_ERROR");
        const found = await deps.store.lookupTemplate(
          user.id,
          raw.request_id.toLowerCase(),
        );
        if (!["committed", "withdrawn", "not_found"].includes(found?.state)) {
          throw new SubmissionError("SERVER_ERROR");
        }
        return reply(found);
      }
      const template = CLINIC_TEMPLATES.find((t) => t.id === raw.template_id);
      if (!template) {
        throw new SubmissionError("UNKNOWN_TEMPLATE", "template_id");
      }
      if (!isObject(raw.fields)) {
        throw new SubmissionError("FIELD_INVALID", "fields");
      }
      const fields = raw.fields;
      if (
        Object.keys(fields).some((k) =>
          !template.fields.some((f) => f.key === k)
        )
      ) {
        throw new SubmissionError("UNKNOWN_FIELD", "fields");
      }
      for (const field of template.fields) {
        const value = fields[field.key];
        if (value !== undefined && typeof value !== "string") {
          throw new SubmissionError("FIELD_INVALID", field.key);
        }
        if (field.required && (typeof value !== "string" || !value.trim())) {
          throw new SubmissionError("FIELD_REQUIRED", field.key);
        }
      }
      const today = todayInPh();
      const validated = validateTemplateSubmission(
        template,
        fields as Record<string, string>,
        today,
      );
      if (!validated.valid) {
        // Locate bounds failures using the same authoritative shared validator.
        for (const field of template.fields) {
          const check = validateTemplateSubmission(
            { ...template, fields: [field] },
            { [field.key]: fields[field.key] as string },
            today,
          );
          if (!check.valid) {
            throw new SubmissionError("FIELD_INVALID", field.key);
          }
        }
        throw new SubmissionError("FIELD_INVALID", "fields");
      }
      if (template.id === "patient-intake") {
        if (
          typeof patient.date_of_birth !== "string" ||
          !validateDobDate(patient.date_of_birth).valid
        ) {
          throw new SubmissionError("SERVER_DATA_INVALID");
        }
        if (!validateAge(patient.date_of_birth).valid) {
          throw new SubmissionError("AGE_REQUIREMENT_NOT_MET", "date_of_birth");
        }
      }
      // All account gates above run again on every replay.
      if (!deps.store) throw new SubmissionError("SERVER_ERROR");
      const built = templateDocument(
        template,
        validated.fields,
        patient,
        deps.now?.() ?? new Date(),
      );
      const outcome = await deps.store.submitTemplate({
        user_id: user.id,
        request_id: raw.request_id.toLowerCase(),
        fingerprint: await templateRequestFingerprint(
          template.id,
          validated.fields,
        ),
        patient_id: patient.id,
        file_name: built.file_name,
        file_path: built.file_path,
        metadata: built.extracted_metadata,
        description: `Patient submitted form template: ${template.name}`,
      });
      switch (outcome.outcome) {
        case "created":
        case "replayed":
          if (!outcome.document_id) throw new SubmissionError("SERVER_ERROR");
          return reply({
            document_id: outcome.document_id,
            status: "pending",
            replayed: outcome.outcome === "replayed",
          });
        case "duplicate":
          // The patient's own pending document, so they can see what is there.
          throw new SubmissionError("DUPLICATE_PENDING", undefined, {
            document_id: outcome.document_id,
            status: outcome.status,
          });
        case "conflict":
          throw new SubmissionError("IDEMPOTENCY_CONFLICT");
        // Never a silent fresh insert (#36): expired or withdrawn requests go
        // to reconciliation under the same request_id.
        case "expired":
        case "withdrawn":
          throw new SubmissionError("RECONCILIATION_REQUIRED");
        default:
          throw new SubmissionError("SERVER_ERROR");
      }
    } catch (error) {
      const safe = error instanceof SubmissionError
        ? error
        : new SubmissionError("SERVER_ERROR");
      return reply({
        error_code: safe.code,
        message: messages[safe.code],
        ...(safe.field ? { field: safe.field } : {}),
        ...safe.extra,
      }, statuses[safe.code]);
    }
  };
}
