/**
 * Multi-query retrieval helpers for the patient assistant (#150).
 *
 * A single query vector is phrasing- and threshold-dependent. Measured against
 * the live knowledge base (15 documents; harness and numbers in
 * `retrieval-eval.test.ts`):
 *
 * - The literal English question "What are Bloodcare Medical Laboratory's
 *   operating hours?" renders correctly in English and still lands
 *   `02_Operating_Hours.pdf` at similarity 0.573 -- below the old 0.6
 *   threshold -- so the assistant declined a question it could answer.
 * - Several answering documents (services 0.557, contact number 0.573, address
 *   0.469) stay below 0.6 in *every* phrasing: with a corpus this small and
 *   this terse, embedding similarity is noisy. No amount of rephrasing fixes
 *   that; the threshold itself has to come down.
 * - Lowering the threshold alone is not enough: at 0.45 with a top-8 cut, the
 *   union is crowded by generic documents scoring 0.55-0.67 and the answering
 *   document (global similarity rank 9-14) is cut out again.
 *
 * So the route embeds several phrasings of the same question -- the patient's
 * own words, the analysed English rendering, and 1-2 model-generated
 * paraphrases -- retrieves a wider candidate list per phrasing at the lower
 * threshold, unions the results keeping the best similarity per document, and
 * cuts the union to {@link RETRIEVAL_TOP_K}. One well-matching phrasing is
 * enough, and the answering document stays in context: 48/48 paraphrases hit,
 * against 32/48 for the single-query 0.6/8 pipeline the eval calls `single`.
 * Context cost stays small: at most 12 of the corpus's tiny (~200-byte)
 * documents; only the embedding/RPC fan-out grows (up to 4 variants, embedded
 * in parallel).
 *
 * The lower threshold is safe for out-of-scope questions because the system
 * prompt still requires the model to decline anything the context cannot
 * answer -- weakly related documents entering context do not answer the
 * question, and the eval records the out-of-scope rankings so that stays
 * visible.
 *
 * Everything here is pure so it can be unit-tested; the route owns the Gemini
 * and Postgres calls that produce the inputs.
 */

/** Tuning shared by the route and the live eval (retrieval-eval.test.ts). */
// 0.45, not the pre-#150 0.6: measured, several answering documents never
// reach 0.6 in any phrasing (module comment above).
export const RETRIEVAL_MATCH_THRESHOLD = 0.45;
/** Per-query candidate count fed into the merge; the context is cut to RETRIEVAL_TOP_K. */
export const RETRIEVAL_MATCH_COUNT = 8;
// 12, not 8: at 0.45 more documents score above the answering document's
// similarity (measured 0.467-0.573) than an 8-document cut leaves room for,
// and 5 of 48 paraphrases lost their answering document to that cut. Still a
// small context: 12 of the corpus's ~200-byte documents.
export const RETRIEVAL_TOP_K = 12;
/** Cap on embedded query variants per message (original + rendering + paraphrases). */
export const MAX_RETRIEVAL_QUERIES = 4;

/** Row shape returned by the `match_documents` RPC. */
export interface RetrievalMatch {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

/**
 * The distinct query variants to embed for one patient question: the patient's
 * own words, the analysed English rendering, and any model-generated
 * alternative phrasings, de-duplicated case-insensitively and capped at
 * {@link MAX_RETRIEVAL_QUERIES} to bound cost and latency.
 *
 * The patient's own words are included deliberately: the analysis call can
 * fail, and even when it succeeds, the original phrasing sometimes ranks the
 * answering document higher than the rendering does.
 */
export function buildRetrievalQueries(
  originalQuery: string,
  analysis: { englishQuery: string; searchQueries: string[] }
): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of [originalQuery, analysis.englishQuery, ...analysis.searchQueries]) {
    const trimmed = candidate.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    queries.push(trimmed);
    if (queries.length === MAX_RETRIEVAL_QUERIES) break;
  }
  // Upstream validation guarantees a non-empty patient question; this keeps the
  // contract local so no caller has to know that.
  if (queries.length === 0) queries.push(originalQuery.trim());
  return queries;
}

/**
 * Union several `match_documents` result lists into one context list.
 *
 * A document returned by more than one query keeps its *best* similarity, then
 * the union is sorted descending and cut to `topK`. Dedupe is by document id:
 * the same chunk reached through two phrasings is one grounding source, not
 * two, so it must not consume two of the topK slots.
 */
export function mergeMatchLists(
  lists: ReadonlyArray<readonly RetrievalMatch[]>,
  topK: number
): RetrievalMatch[] {
  const byId = new Map<string, RetrievalMatch>();
  for (const list of lists) {
    for (const match of list) {
      const previous = byId.get(match.id);
      if (!previous || match.similarity > previous.similarity) {
        byId.set(match.id, match);
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(0, topK));
}
