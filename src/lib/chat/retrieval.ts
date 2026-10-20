/**
 * Multi-query retrieval helpers for the patient assistant (#150).
 *
 * A single query vector is phrasing-dependent: measured against the live
 * knowledge base, "What are Bloodcare Medical Laboratory's operating hours?"
 * renders in English and still lands `02_Operating_Hours.pdf` at similarity
 * 0.573 -- below the 0.6 threshold -- so the assistant declined a question it
 * could answer. The fix embeds several phrasings of the same question -- the
 * patient's own words, the analysed English rendering, and 1-2 model-generated
 * paraphrases -- retrieves with each, and unions the results, keeping the best
 * similarity per document. One well-matching phrasing is then enough.
 *
 * Threshold/count/topK tuning is measured, not guessed: the live eval in
 * `retrieval-eval.test.ts` (npm run test:chat-eval) runs a fixed paraphrase
 * set against the live knowledge base and reports hit rates per pipeline.
 *
 * Everything here is pure so it can be unit-tested; the route owns the Gemini
 * and Postgres calls that produce the inputs.
 */

/** Tuning shared by the route and the live eval (retrieval-eval.test.ts). */
export const RETRIEVAL_MATCH_THRESHOLD = 0.6;
/** Per-query candidate count fed into the merge; the context is cut to RETRIEVAL_TOP_K. */
export const RETRIEVAL_MATCH_COUNT = 8;
/** Documents that end up in the grounding context. */
export const RETRIEVAL_TOP_K = 8;
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
