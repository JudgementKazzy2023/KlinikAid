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

    const supabase = await createClient();

    // A document's chunks all carry the same `metadata.document_id`. The row
    // id is matched as well because a chunk stored before the indexer wrote
    // that metadata is its own document, and the list view lists it under its
    // own id.
    const read = classifyRead(
      await supabase
        .from("rag_documents")
        .select("id, title, content, metadata, created_at")
        .or(`metadata->>document_id.eq.${documentId},id.eq.${documentId}`)
        .order("created_at", { ascending: true })
    );

    if (read.kind === "failed") {
      // The query did not answer. Saying "no such document" here would turn a
      // database fault into a confident claim that the document is gone.
      return handleRouteError(read.error, LOAD_FAILED);
    }

    if (read.kind === "absent") {
      return errorResponse("Document not found.", 404);
    }

    const document = assembleRagDocument(read.data as unknown as RagChunkRow[], documentId);

    if (!document) {
      // The query ran and matched nothing: the document is not there.
      return errorResponse("Document not found.", 404);
    }

    return successResponse({ document });
  } catch (error: unknown) {
    return handleRouteError(error, LOAD_FAILED);
  }
}
