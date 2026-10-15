import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

// What the anon key can see with no session, table by table. RLS filters rather
// than denies, so a policy that opens a table produces no error anywhere -- it
// just starts returning rows. This pins the intended posture so a change in
// either direction fails here instead of going unnoticed (#39).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("test:rls needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local)");
}

const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PRIVATE_TABLES = [
  "chatbot_logs",
  "department_records",
  "documents",
  "email_verification_codes",
  "patient_queue",
  "patients",
  "pending_document_ocr",
  "permissions",
  "profiles",
  "role_permissions",
  "roles",
  "specialist_patients",
  "specialist_records",
  "system_logs",
] as const;

describe("anon, no session", () => {
  it.each(PRIVATE_TABLES)("sees zero rows in %s", async (table) => {
    const { count, error } = await anon.from(table).select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  // Deliberately public: the chatbot's clinic-information corpus.
  it("can read rag_documents content", async () => {
    const { data, error } = await anon.from("rag_documents").select("id, title, content, metadata, created_at").limit(1);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // ...but not the retrieval vectors (migration_23).
  it("cannot read rag_documents.embedding", async () => {
    const { data, error } = await anon.from("rag_documents").select("embedding").limit(1);
    // Checked before data so a failure does not print a 768-float vector.
    expect(error?.code, "embedding is anon-readable; is migration_23 applied?").toBe("42501");
    expect(data).toBeNull();
  });
});
