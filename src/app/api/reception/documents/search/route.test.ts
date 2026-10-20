import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { SEARCH_RESULT_LIMIT } from "@/lib/reception-search";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  authGetUser: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.authGetUser }, from: fakeFrom }),
}));

/** One recorded PostgREST query the route issued. */
interface RecordedQuery {
  table: string;
  select: string;
  or: { conditions: string; options?: { referencedTable?: string } }[];
  orders: { column: string; options?: Record<string, unknown> }[];
  limit?: number;
}

type BranchKey = "file" | "patient" | "uploader";

interface Branch {
  data: Record<string, unknown>[];
  error: { message: string } | null;
}

/**
 * The three branch answers. Each branch models one PostgREST query over
 * `documents`: matching file fields, matching patient names (via the
 * `patient.or=` embedded filter), matching uploader names.
 */
const branches: Record<BranchKey, Branch> = {
  file: { data: [], error: null },
  patient: { data: [], error: null },
  uploader: { data: [], error: null },
};

const queries: RecordedQuery[] = [];

function fakeFrom(table: string) {
  const query: RecordedQuery = { table, select: "", or: [], orders: [] };
  const builder = {
    select(select: string) {
      query.select = select;
      return builder;
    },
    or(conditions: string, options?: { referencedTable?: string }) {
      query.or.push({ conditions, options });
      return builder;
    },
    order(column: string, options?: Record<string, unknown>) {
      query.orders.push({ column, options });
      return builder;
    },
    limit(limit: number) {
      query.limit = limit;
      return builder;
    },
    then(
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject?: (reason: unknown) => void
    ) {
      queries.push(query);
      const key = branchKeyOf(query);
      const branch = branches[key];
      // Model PostgREST: the limit bounds what the branch can report.
      const limit = query.limit ?? branches[key].data.length;
      Promise.resolve({ data: branch.error ? null : branch.data.slice(0, limit), error: branch.error }).then(resolve, reject);
    },
  };
  return builder;
}

/** Which of the three search branches issued this query. */
function branchKeyOf(query: RecordedQuery): BranchKey {
  const referencedTable = query.or[0]?.options?.referencedTable;
  return referencedTable === "patient" ? "patient" : referencedTable === "uploader" ? "uploader" : "file";
}

const search = (q: string) => GET(new Request(`http://test/api/reception/documents/search?q=${encodeURIComponent(q)}`));

/**
 * One document whose PATIENT NAME matches the search tag. 51 of these model
 * "more matching names than any list cap": the 51st is the document that only
 * a name past a 50-name cap would belong to.
 */
function patientMatchDoc(index: number, createdAt: string) {
  return {
    id: `doc-patient-${String(index).padStart(2, "0")}`,
    patient_id: `patient-${index}`,
    uploader_id: "uploader-1",
    file_name: `file-${index}.pdf`,
    file_path: "patient-documents/x",
    file_type: "application/pdf",
    status: "pending",
    created_at: createdAt,
    updated_at: createdAt,
    patient: { id: `patient-${index}`, first_name: `Qa129`, last_name: `Patient ${index}` },
    uploader: { id: "uploader-1", full_name: "Staff", role: "receptionist" },
  };
}

describe("reception document search completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: "receptionist" } }, error: null });
    mocks.requirePermission.mockResolvedValue({ id: "receptionist" });
    branches.file = { data: [], error: null };
    branches.patient = { data: [], error: null };
    branches.uploader = { data: [], error: null };
    queries.length = 0;
  });

  it("finds a document whose name is past any name-list cap, and reports the result truncated", async () => {
    // 51 distinct matching patient names, one document each. The last name is
    // exactly the one a 50-name cap would have dropped before querying
    // documents (#129); its document is the newest, so it must survive the
    // final 50-document cap.
    const older = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, i) =>
      patientMatchDoc(i + 1, `2026-10-01T00:00:${String(59 - i).padStart(2, "0")}+00:00`)
    );
    const omittedNameDoc = patientMatchDoc(SEARCH_RESULT_LIMIT + 1, "2026-10-02T00:00:00+00:00");
    branches.patient = { data: [...older, omittedNameDoc], error: null };

    const body = (await (await search("qa129")).json()).data;

    expect(body.documents).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(body.truncated).toBe(true);
    expect(body.documents.map((d: { id: string }) => d.id)).toContain(omittedNameDoc.id);
    // Newest-first is preserved across the merged branches.
    const timestamps = body.documents.map((d: { created_at: string }) => d.created_at);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  it("searches documents directly and never resolves names through a capped id list", async () => {
    branches.patient = { data: [patientMatchDoc(1, "2026-10-01T00:00:00+00:00")], error: null };

    await search("qa129");

    // Name resolution against patients/profiles would reintroduce the cap that
    // silently dropped documents: every query must target documents itself.
    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.table === "documents")).toBe(true);
    // No branch may hand a capped list of foreign keys to the documents query.
    const conditions = queries.flatMap((query) => query.or.map((or) => or.conditions)).join(",");
    expect(conditions).not.toContain("patient_id.in.");
    expect(conditions).not.toContain("uploader_id.in.");
    // buildSearchPattern emits a regex for `imatch` (#130). Under `ilike` the
    // same unwrapped pattern would only match whole values exactly.
    expect(conditions).not.toMatch(/\.i?like\./);
    expect(conditions).toContain("file_name.imatch.");
    expect(conditions).toContain("full_name.imatch.");
    // Each branch is bounded only by the shared result bound (+1 for detection).
    expect(queries.every((query) => query.limit === SEARCH_RESULT_LIMIT + 1)).toBe(true);
    // The name branches filter through embedded-resource joins.
    const patientQuery = queries.find((query) => query.or[0]?.options?.referencedTable === "patient");
    expect(patientQuery?.select).toContain("patient:patient_id!inner");
    const uploaderQuery = queries.find((query) => query.or[0]?.options?.referencedTable === "uploader");
    expect(uploaderQuery?.select).toContain("uploader:uploader_id!inner");
    // The file-field branch must keep a plain join: an inner join there would
    // drop documents whose patient_id is null out of file-name matches.
    const fileQuery = queries.find((query) => query.or[0]?.options?.referencedTable === undefined);
    expect(fileQuery?.select).not.toContain("!inner");
  });

  it("reports a complete search without truncation and de-duplicates documents across branches", async () => {
    const shared = patientMatchDoc(1, "2026-10-01T00:00:00+00:00");
    const olderFileMatch = {
      ...patientMatchDoc(2, "2026-09-01T00:00:00+00:00"),
      id: "doc-file-only",
      file_name: "qa129-report.pdf",
    };
    branches.patient = { data: [shared], error: null };
    // The same document also matches the file-field branch.
    branches.file = { data: [{ ...shared, file_name: "qa129-file.pdf" }, olderFileMatch], error: null };

    const body = (await (await search("qa129")).json()).data;

    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-patient-01", "doc-file-only"]);
    expect(body.truncated).toBe(false);
  });

  it("reports an empty result as complete only when no branch matched", async () => {
    const body = (await (await search("qa129-nothing")).json()).data;

    expect(body.documents).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it("marks the result truncated when the merged union exceeds the cap although no branch was cut off", async () => {
    // Two branches under the cap each, together more than the cap: the union
    // was capped, so the search was not complete.
    branches.file = { data: Array.from({ length: 30 }, (_, i) => patientMatchDoc(i + 1, `2026-10-01T01:00:${String(i).padStart(2, "0")}+00:00`)), error: null };
    branches.uploader = {
      data: Array.from({ length: 25 }, (_, i) => patientMatchDoc(i + 31, `2026-10-01T02:00:${String(i).padStart(2, "0")}+00:00`)),
      error: null,
    };

    const body = (await (await search("qa129")).json()).data;

    expect(body.documents).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it("orders every search branch newest-first before its limit (#140)", async () => {
    await search("qa129");

    // Each branch's 51-row limit only keeps the newest documents when the
    // branch is ordered created_at descending *before* the limit; without it
    // the bound would keep arbitrary rows and the completeness contract would
    // silently hold the oldest matches.
    expect(queries).toHaveLength(3);
    const ordersByBranch = new Map(
      queries.map((query) => [branchKeyOf(query), query.orders] as const)
    );
    expect([...ordersByBranch.keys()].sort()).toEqual(["file", "patient", "uploader"]);
    for (const orders of ordersByBranch.values()) {
      expect(orders).toEqual([{ column: "created_at", options: { ascending: false } }]);
    }
  });

  it("fails the whole search when one branch fails, instead of answering with the rest", async () => {
    branches.file = { data: [patientMatchDoc(1, "2026-10-01T00:00:00+00:00")], error: null };
    branches.uploader = { data: [], error: { message: "database did not answer" } };

    const response = await search("qa129");

    // A partial answer would look complete to the caller; a failure must never
    // degrade into "fewer matches" or "no matches".
    expect(response.status).toBe(500);
  });
});
