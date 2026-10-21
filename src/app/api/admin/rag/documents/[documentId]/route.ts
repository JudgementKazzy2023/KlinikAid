import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { classifyRead } from "@/lib/read-outcome";
import {
  assembleRagDocument,
  isRagDocumentId,
  type RagChunkRow,
} from "@/lib/rag/document-content";

export const dynamic = "force-dynamic";

const LOAD_FAILED = "Failed to load the document's indexed text.";

/**
 * How many chunk rows one request asks for. It matches the row limit
 * PostgREST applies, so a full page means there may be more behind it.
 */
const CHUNK_PAGE = 1000;

/**
 * GET /api/admin/rag/documents/[documentId]
 *
 * The indexed text of one knowledge document, reassembled from the chunks it
 * was stored as.
 *
 * The permission is the same one the RAG manager page and its upload and
 * delete actions use -- `rag_documents.manage`, which resolves through
 * `role_id` -> `role_permissions`. It is checked here, on the server, because
 * the button that opens the view is a UI affordance and not a boundary: the
 * content of the knowledge base is what the assistant answers from, and a
 * caller who cannot manage it must not be able to read it.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await props.params;

  try {
    await requirePermission("rag_documents.manage");

    if (!isRagDocumentId(documentId)) {
      return errorResponse("Invalid document id.", 400);
    }

    // A uuid is the same uuid in either case, but the stored document id is
    // lower case, and the metadata comparison is case sensitive. An upper case
    // request would therefore find nothing and answer 404 for a document that
    // is there.
    const normalizedDocumentId = documentId.toLowerCase();

    const supabase = await createClient();

    // A document's chunks all carry the same `metadata.document_id`. The row
    // id is matched as well, but only for a row that has no document id of its
    // own: a chunk stored before the indexer wrote that metadata is its own
    // document, and the list view lists it under its own id. Without that
    // restriction, asking for a chunk's row id would hand back that chunk
    // under a different document's name.
    const filter = `metadata->>document_id.eq.${normalizedDocumentId},and(id.eq.${normalizedDocumentId},metadata->>document_id.is.null)`;

    // PostgREST returns at most 1,000 rows for one request, and it says
    // nothing when it stops early. A document with more chunks than that would
    // come back truncated, and a truncated document reads exactly like a
    // complete one, so the pages are walked to the end. The order is stable
    // across pages -- the id breaks the tie -- so a chunk cannot be read
    // twice or missed at a page boundary.
    const rows: RagChunkRow[] = [];
    let offset = 0;
    let page: RagChunkRow[] = [];

    do {
      const read = classifyRead(
        await supabase
          .from("rag_documents")
          .select("id, title, content, metadata, created_at")
          .or(filter)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + CHUNK_PAGE - 1)
      );

      if (read.kind === "failed") {
        // The query did not answer. Saying "no such document" here would turn
        // a database fault into a confident claim that the document is gone.
        return handleRouteError(read.error, LOAD_FAILED);
      }

      if (read.kind === "absent") {
        return errorResponse("Document not found.", 404);
      }

      page = (read.data ?? []) as unknown as RagChunkRow[];
      rows.push(...page);
      offset += page.length;
    } while (page.length === CHUNK_PAGE);

    const document = assembleRagDocument(rows, normalizedDocumentId);

    if (!document) {
      // The query ran and matched nothing: the document is not there.
      return errorResponse("Document not found.", 404);
    }

    return successResponse({ document });
  } catch (error: unknown) {
    return handleRouteError(error, LOAD_FAILED);
  }
}
