// Test doubles intentionally implement asynchronous ports without external IO.
// deno-lint-ignore-file require-await
import {
  createHandler,
  type Identity,
  type Outcome,
  type Patient,
  type Profile,
  statuses,
  type SubmissionStore,
  type TemplateSubmission,
  type User,
} from "./handler.ts";
import { CLINIC_TEMPLATES } from "@/lib/documentTemplates";
import {
  latestTemplateDate,
  reviewTemplateSubmission,
  todayInPh,
} from "@/lib/documents/templateChecks";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const receiptKey = (userId: string, requestId: string) =>
  JSON.stringify([userId, requestId]);

// TEST ONLY: returns the outcomes of public.submit_patient_template
// (migration_40) without a database. The SQL itself is checked separately.
class FakeStore implements SubmissionStore {
  receipts = new Map<
    string,
    { fingerprint: string; document_id: string | null; expired?: boolean }
  >();
  documents: TemplateSubmission[] = [];
  audits: { user_id: string; description: string; document_id: string }[] = [];
  duplicate: string | null = null;
  failCommit = false;
  loseResponse = false;
  async submitTemplate(input: TemplateSubmission): Promise<Outcome> {
    if (this.failCommit) {
      throw new Error("Sensitive database detail must not escape");
    }
    const key = receiptKey(input.user_id, input.request_id);
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.expired) return { outcome: "expired" };
      if (!receipt.document_id) return { outcome: "withdrawn" };
      if (receipt.fingerprint !== input.fingerprint) {
        return { outcome: "conflict" };
      }
      return { outcome: "replayed", document_id: receipt.document_id };
    }
    if (this.duplicate) {
      return {
        outcome: "duplicate",
        document_id: this.duplicate,
        status: "pending",
      };
    }
    const document_id = crypto.randomUUID();
    this.documents.push(input);
    this.audits.push({
      user_id: input.user_id,
      description: input.description,
      document_id,
    });
    this.receipts.set(key, { fingerprint: input.fingerprint, document_id });
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("Synthetic response lost after atomic commit");
    }
    return { outcome: "created", document_id };
  }
}

function fixture() {
  const state: {
    user: User | null;
    profile: Profile | null;
    patient: Patient | null;
  } = {
    user: {
      id: "profile-uuid",
      email_confirmed_at: "2026-01-01",
      app_metadata: {},
    },
    profile: {
      role: "patient",
      is_active: true,
      accepted_privacy_at: "2026-01-01",
    },
    patient: {
      id: "DIFFERENT-patient-row-uuid",
      profile_id: "profile-uuid",
      first_name: "Synthetic",
      last_name: "Fixture",
      date_of_birth: "1990-01-01",
      contact_number: "fixture-contact",
      address: "fixture-address",
    },
  };
  const store = new FakeStore();
  const lookups: string[] = [];
  const identity: Identity = {
    authenticate: async (token) => token === "fixture" ? state.user : null,
    profile: async () => state.profile,
    patientByProfile: async (userId) => {
      lookups.push(userId);
      return state.patient;
    },
  };
  const handler = createHandler({ identity, store });
  return { state, store, identity, handler, lookups };
}
function body(
  templateId = "referral-form",
  requestId = id,
): Record<string, unknown> {
  const template = CLINIC_TEMPLATES.find((t) => t.id === templateId)!;
  return {
    request_id: requestId,
    template_id: templateId,
    fields: Object.fromEntries(template.fields.map((f) => [
      f.key,
      f.type === "date"
        ? todayInPh()
        : f.type === "select"
        ? f.options![0]
        : "Synthetic answer",
    ])),
  };
}
async function call(
  f: ReturnType<typeof fixture>,
  input = body(),
  token = "fixture",
) {
  const response = await f.handler(
    new Request("https://example.invalid/submit-template", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, body: await response.json() };
}

for (const template of CLINIC_TEMPLATES) {
  Deno.test(`valid ${template.id}: derived identity, metadata, one audit`, async () => {
    const f = fixture();
    const result = await call(f, body(template.id));
    equal(result.status, 200);
    equal(result.body.replayed, false);
    equal(f.lookups, ["profile-uuid"]);
    equal(f.store.documents.length, 1);
    const doc = f.store.documents[0];
    equal(doc.patient_id, "DIFFERENT-patient-row-uuid");
    equal(doc.user_id, "profile-uuid");
    equal(doc.metadata.patient_name, "Synthetic Fixture");
    equal(doc.metadata.template_name, template.name);
    equal(doc.metadata.submission_type, "template");
    equal(f.store.audits.length, 1);
    equal(f.store.audits[0].user_id, "profile-uuid");
    equal(f.store.audits[0].document_id, result.body.document_id);
    for (const key of ["date_of_birth", "contact_number", "address"]) {
      equal(key in doc.metadata, template.id === "patient-intake");
    }
    equal(reviewTemplateSubmission(doc.metadata).status, "passed");
  });
}
Deno.test("normalized replay preserves document and emits no audit; changed content conflicts", async () => {
  const f = fixture();
  const original = body();
  const first = await call(f, original);
  const changedSpacing = body();
  (changedSpacing.fields as Record<string, string>).referring_physician =
    " Synthetic answer ";
  const replay = await call(f, changedSpacing);
  equal(replay.body, { ...first.body, replayed: true });
  (changedSpacing.fields as Record<string, string>).referring_physician =
    "Different";
  equal(
    (await call(f, changedSpacing)).body.error_code,
    "IDEMPOTENCY_CONFLICT",
  );
  equal(f.store.documents.length, 1);
  equal(f.store.audits.length, 1);
});
Deno.test("concurrent same key creates one fixture document", async () => {
  const f = fixture();
  const results = await Promise.all([call(f), call(f)]);
  equal(f.store.documents.length, 1);
  equal(f.store.audits.length, 1);
  equal(results.map((r) => r.status), [200, 200]);
  equal(results[0].body.document_id, results[1].body.document_id);
});
Deno.test("same request UUID is scoped to authenticated owner", async () => {
  const f = fixture();
  await call(f);
  f.state.user!.id = "another-profile";
  f.state.patient!.profile_id = "another-profile";
  f.state.patient!.id = "another-patient";
  equal((await call(f)).body.replayed, false);
  equal(f.store.documents.length, 2);
});
Deno.test("account gates run on initial call AND successful replay", async () => {
  const cases: [
    keyof typeof statuses,
    (f: ReturnType<typeof fixture>) => void,
  ][] = [
    ["UNAUTHENTICATED", (f) => {
      f.state.user = null;
    }],
    ["NO_PATIENT_RECORD", (f) => {
      f.state.patient = null;
    }],
    ["PROFILE_INACTIVE", (f) => {
      f.state.profile!.is_active = false;
    }],
    ["EMAIL_NOT_CONFIRMED", (f) => {
      f.state.user!.email_confirmed_at = undefined;
    }],
    ["CONSENT_REQUIRED", (f) => {
      f.state.profile!.accepted_privacy_at = null;
    }],
    ["PASSWORD_CHANGE_REQUIRED", (f) => {
      f.state.user!.app_metadata.must_change_password = true;
    }],
  ];
  for (const [code, mutate] of cases) {
    for (const replay of [false, true]) {
      const f = fixture();
      if (replay) await call(f);
      mutate(f);
      const result = await call(f);
      equal(result.status, statuses[code]);
      equal(result.body.error_code, code);
      equal(f.store.documents.length, replay ? 1 : 0);
    }
  }
});
Deno.test("identity mismatch and failed reads fail closed, not missing patient", async () => {
  const f = fixture();
  f.state.patient!.profile_id = "wrong";
  equal((await call(f)).body.error_code, "SERVER_ERROR");
  f.identity.patientByProfile = async () => {
    throw new Error("private details");
  };
  equal((await call(f)).body.error_code, "SERVER_ERROR");
  equal(f.store.documents.length, 0);
});
Deno.test("reject server columns, unknown fields/templates, malformed request", async () => {
  const f = fixture();
  for (
    const key of [
      "patient_id",
      "uploader_id",
      "status",
      "file_type",
      "file_name",
      "file_path",
      "submitted_at",
      "extracted_metadata",
    ]
  ) {
    equal(
      (await call(f, { ...body(), [key]: "approved" })).body.error_code,
      "UNKNOWN_FIELD",
    );
  }
  equal(
    (await call(f, { ...body(), template_id: "unknown" })).body.error_code,
    "UNKNOWN_TEMPLATE",
  );
  equal(
    (await call(f, { ...body(), fields: { patient_name: "spoof" } })).body
      .error_code,
    "UNKNOWN_FIELD",
  );
  equal(
    (await call(f, { ...body(), request_id: "bad" })).body.field,
    "request_id",
  );
  equal(
    (await call(f, { ...body(), fields: [] })).body.error_code,
    "FIELD_INVALID",
  );
  equal(
    (await call(f, body(), "invalid-token")).body.error_code,
    "UNAUTHENTICATED",
  );
  equal(f.store.documents.length, 0);
});
Deno.test("field boundaries, whitespace, date and choice validation", async () => {
  const cases: [string, unknown, string][] = [
    ["referring_physician", " ", "FIELD_REQUIRED"],
    ["referring_physician", "x".repeat(201), "FIELD_INVALID"],
    ["reason_for_referral", "x".repeat(2001), "FIELD_INVALID"],
    ["referral_date", "1899-12-31", "FIELD_INVALID"],
    ["referral_date", "2026-02-30", "FIELD_INVALID"],
    ["referral_date", "9999-01-01", "FIELD_INVALID"],
    ["requested_service", "invalid", "FIELD_INVALID"],
    ["referring_clinic", 42, "FIELD_INVALID"],
  ];
  for (const [key, value, code] of cases) {
    const f = fixture();
    const input = body();
    (input.fields as Record<string, unknown>)[key] = value;
    const result = await call(f, input);
    equal(result.body.error_code, code);
    equal(result.body.field, key);
    equal(f.store.documents.length, 0);
  }
  const f = fixture();
  const input = body();
  const fields = input.fields as Record<string, string>;
  fields.referring_physician = "x".repeat(200);
  fields.reason_for_referral = "x".repeat(2000);
  delete fields.referring_clinic;
  equal((await call(f, input)).status, 200);
  equal(f.store.documents[0].metadata.referring_clinic, "");
});
Deno.test("intake age boundary Manila; other forms do not impose intake age", async () => {
  const [year, month, day] = todayInPh().split("-").map(Number);
  for (const age of [17, 18, 120, 121]) {
    const f = fixture();
    f.state.patient!.date_of_birth = `${year - age}-${
      String(month).padStart(2, "0")
    }-${String(day).padStart(2, "0")}`;
    equal(
      (await call(f, body("patient-intake"))).status,
      age === 18 || age === 120 ? 200 : age === 121 ? 500 : 403,
    );
  }
  const f = fixture();
  f.state.patient!.date_of_birth = `${year - 10}-01-01`;
  equal((await call(f)).status, 200);
});
Deno.test("declined form consent is accepted and reception flags it", async () => {
  const f = fixture();
  const input = body("procedure-consent");
  (input.fields as Record<string, string>).consent_given = "No";
  equal((await call(f, input)).status, 200);
  equal(
    reviewTemplateSubmission(f.store.documents[0].metadata).status,
    "attention",
  );
});
Deno.test("duplicate pending returns the existing document without insert", async () => {
  const f = fixture();
  f.store.duplicate = id;
  const result = await call(f, body("lab-request", id2));
  equal(result.status, 409);
  equal(result.body.error_code, "DUPLICATE_PENDING");
  equal(result.body.document_id, id);
  equal(result.body.status, "pending");
  equal(f.store.documents.length, 0);
});
Deno.test("expired or withdrawn receipt needs reconciliation, never a new insert", async () => {
  for (
    const receipt of [
      { fingerprint: "any", document_id: "doc", expired: true },
      { fingerprint: "any", document_id: null },
    ]
  ) {
    const f = fixture();
    f.store.receipts.set(receiptKey("profile-uuid", id), receipt);
    const result = await call(f);
    equal(result.status, 409);
    equal(result.body.error_code, "RECONCILIATION_REQUIRED");
    equal(f.store.documents.length, 0);
  }
});
Deno.test("missing production store fails closed; commit errors leak no private details", async () => {
  const f = fixture();
  f.store.failCommit = true;
  const result = await call(f);
  equal(result.body.error_code, "SERVER_ERROR");
  equal(JSON.stringify(result).includes("Sensitive"), false);
  f.handler = createHandler({ identity: f.identity });
  equal((await call(f)).status, 503);
  equal(f.store.documents.length, 0);
});
Deno.test("request id is case-insensitive for replay", async () => {
  const f = fixture();
  const first = await call(f);
  const replay = await call(f, body("referral-form", id.toUpperCase()));
  equal(replay.body, { ...first.body, replayed: true });
});
Deno.test("exact date boundaries and non-future dates match pinned web", async () => {
  const today = todayInPh();
  const nextDay = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(
      0,
      10,
    );
  for (
    const [template, key, date, status] of [
      ["lab-request", "request_date", "1900-01-01", 200],
      ["lab-request", "request_date", latestTemplateDate(today), 200],
      ["lab-request", "request_date", nextDay(latestTemplateDate(today)), 400],
      ["referral-form", "referral_date", nextDay(today), 400],
      ["procedure-consent", "consent_date", nextDay(today), 400],
      ["results-release", "authorization_date", nextDay(today), 200],
    ] as const
  ) {
    const f = fixture();
    const input = body(template);
    (input.fields as Record<string, string>)[key] = date;
    equal((await call(f, input)).status, status);
  }
});
Deno.test("malformed JSON, missing bearer, and non-object body fail safely", async () => {
  const f = fixture();
  for (
    const [text, authorization, code] of [
      ["{", "Bearer fixture", "FIELD_INVALID"],
      ["null", "Bearer fixture", "FIELD_INVALID"],
      ["[]", "Bearer fixture", "FIELD_INVALID"],
      [JSON.stringify(body()), "", "UNAUTHENTICATED"],
    ]
  ) {
    const response = await f.handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { authorization },
        body: text,
      }),
    );
    equal((await response.json()).error_code, code);
  }
  equal(f.store.documents.length, 0);
});
Deno.test("OPTIONS and unsupported methods perform no identity or store calls", async () => {
  const identity: Identity = {
    authenticate: () => {
      throw new Error("must not authenticate");
    },
    profile: () => {
      throw new Error("must not read profile");
    },
    patientByProfile: () => {
      throw new Error("must not read patient");
    },
  };
  const handler = createHandler({ identity });
  for (const method of ["OPTIONS", "GET", "PUT", "DELETE", "PATCH"]) {
    const response = await handler(
      new Request("https://example.invalid", { method }),
    );
    equal(response.status, method === "OPTIONS" ? 200 : 405);
    equal(
      response.headers.get("Access-Control-Allow-Methods"),
      "POST, OPTIONS",
    );
    if (method !== "OPTIONS") {
      equal(response.headers.get("Allow"), "POST, OPTIONS");
      equal((await response.json()).error_code, "METHOD_NOT_ALLOWED");
    }
  }
});
Deno.test("patient role and linked row are independent gates, including replays", async () => {
  for (const replay of [false, true]) {
    const f = fixture();
    if (replay) await call(f);
    f.state.profile!.role = "admin";
    equal((await call(f)).body.error_code, "PATIENT_ACCOUNT_REQUIRED");
    f.state.profile!.role = "patient";
    f.state.patient = null;
    equal((await call(f)).body.error_code, "NO_PATIENT_RECORD");
    equal(f.store.documents.length, replay ? 1 : 0);
  }
});
Deno.test("bad stored DOB is server data error only for intake; read failure is unavailable", async () => {
  for (
    const dob of [
      null,
      "",
      "not-a-date",
      "2025-02-30",
      "1800-01-01",
      "9999-01-01",
    ]
  ) {
    const f = fixture();
    f.state.patient!.date_of_birth = dob;
    const result = await call(f, body("patient-intake"));
    equal(result.status, 500);
    equal(result.body.error_code, "SERVER_DATA_INVALID");
    equal(result.body.message.includes("contact the clinic"), true);
    equal(result.body.field, undefined);
    if (dob) equal(JSON.stringify(result).includes(dob), false);
    equal(f.store.documents.length, 0);
    equal((await call(f)).status, 200);
  }
  const f = fixture();
  f.identity.patientByProfile = async () => {
    throw new Error("read unavailable");
  };
  equal(
    (await call(f, body("patient-intake"))).body.error_code,
    "SERVER_ERROR",
  );
});
Deno.test("ambiguous post-commit timeout resolves through same key without another event", async () => {
  const f = fixture();
  f.store.loseResponse = true;
  equal((await call(f)).body.error_code, "SERVER_ERROR");
  const result = await call(f);
  equal(result.status, 200);
  equal(result.body.replayed, true);
  equal(result.body.document_id, f.store.audits[0].document_id);
  equal(f.store.documents.length, 1);
  equal(f.store.audits.length, 1);
});
Deno.test("atomic commit failure leaves no fixture document, event, or receipt", async () => {
  const f = fixture();
  f.store.failCommit = true;
  equal((await call(f)).status, 503);
  equal(f.store.documents.length, 0);
  equal(f.store.audits.length, 0);
  equal(f.store.receipts.size, 0);
});
