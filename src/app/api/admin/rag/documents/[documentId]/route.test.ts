import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { AuthError } from "@/lib/api-response";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        or: (...args: unknown[]) => {
          mocks.or(...args);
          return { order: (...orderArgs: unknown[]) => mocks.order(...orderArgs) };
        },
      }),
    }),
  }),
}));

const DOCUMENT_ID = "6aee0a07-8a7a-493f-a6d1-75ecc87f64c0";

const get = (documentId: string = DOCUMENT_ID) =>
  GET(new Request(`http://test/api/admin/rag/documents/${documentId}`), {
    params: Promise.resolve({ documentId }),
  });

function chunkRow(
  id: string,
  content: string,
  chunkIndex: number,
  createdAt = "2026-07-08T06:17:59.634679+00:00"
) {
  return {
    id,
    title: "Clinic Overview",
    content,
    created_at: createdAt,
    metadata: {
      document_id: DOCUMENT_ID,
      chunk_index: chunkIndex,
      total_chunks: 2,
      source_type: "text",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.order.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/admin/rag/documents/[documentId]", () => {
  it("guards the read with the same permission the RAG manager uses", async () => {
    mocks.order.mockResolvedValue({ data: [chunkRow("row-0", "text", 0)], error: null });

    const response = await get();

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith("rag_documents.manage");
  });

  it("refuses a caller without the permission before reading anything", async () => {
    mocks.requirePermission.mockRejectedValue(
      new AuthError(403, "FORBIDDEN: Missing permission 'rag_documents.manage'")
    );

    const response = await get();

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Forbidden: Access denied.");
    expect(mocks.order).not.toHaveBeenCalled();
  });

  it("answers an unauthenticated caller with 401", async () => {
    mocks.requirePermission.mockRejectedValue(
      new AuthError(401, "UNAUTHORIZED: Session not found")
    );

    const response = await get();

    expect(response.status).toBe(401);
    expect((await response.json()).message).toBe("Unauthorized: Please sign in.");
    expect(mocks.order).not.toHaveBeenCalled();
  });

  it("rejects a document id that is not a uuid before querying", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.order).not.toHaveBeenCalled();
  });

  it("answers 404 when the document has no chunks", async () => {
    const response = await get();

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Document not found.");
  });

  it("returns the document's chunks in chunk order with its metadata", async () => {
    mocks.order.mockResolvedValue({
      data: [
        chunkRow("row-1", "second chunk", 1, "2026-07-08T06:18:00+00:00"),
        chunkRow("row-0", "first chunk", 0, "2026-07-08T06:17:59+00:00"),
      ],
      error: null,
    });

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.document).toMatchObject({
      documentId: DOCUMENT_ID,
      title: "Clinic Overview",
      sourceType: "text",
      chunkCount: 2,
      characterCount: "first chunk".length + "second chunk".length,
      indexedAt: "2026-07-08T06:17:59+00:00",
    });
    expect(body.data.document.chunks.map((c: { content: string }) => c.content)).toEqual([
      "first chunk",
      "second chunk",
    ]);
    expect(body.data.document.chunks.map((c: { position: number }) => c.position)).toEqual([1, 2]);
  });

  it("reads the chunks by their document id, and by the row id only for a legacy row", async () => {
    mocks.order.mockResolvedValue({ data: [chunkRow("row-0", "text", 0)], error: null });

    await get();

    // The row id fallback is limited to a row that carries no document id of
    // its own. Without that, asking for a chunk's row id would return that
    // chunk under another document's name.
    expect(mocks.or).toHaveBeenCalledWith(
      `metadata->>document_id.eq.${DOCUMENT_ID},and(id.eq.${DOCUMENT_ID},metadata->>document_id.is.null)`
    );
  });

  it("reports a failed query as a failure, not as a missing document", async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe("Failed to load the document's indexed text.");
    expect(body.message).not.toMatch(/not found/i);
  });
});
