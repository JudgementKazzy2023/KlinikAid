/**
 * Language and query handling for the patient assistant (#73 item 9).
 *
 * The clinic knowledge base is English-only, but patients write in English,
 * Filipino or mixed Taglish. Embedding the patient's own words ranks the
 * document that answers them below the `match_count` cutoff (measured: the
 * operating-hours doc ranks 3rd for the literal English question and 10th for
 * the Filipino one), so the model answered from context that had no answer and
 * declined. Retrieval therefore runs on an English rendering of the question,
 * while the reply follows the language the patient wrote in. Renderings vary in
 * phrasing ("What time is the clinic open?" puts that doc at #6, similarity
 * 0.628 — above the 0.6 threshold, outside a count of 5), so the route also
 * widens `match_count` to 8; raising the threshold would not help here.
 *
 * Everything here is pure so it can be unit-tested; the route owns the Gemini
 * call that produces the raw analysis text.
 */

export type QueryLanguage = "english" | "filipino" | "taglish" | "unknown";

export interface QueryAnalysis {
  language: QueryLanguage;
  englishQuery: string;
}

/** Instruction for the one flash call that renders the question in English. */
export const QUERY_ANALYSIS_INSTRUCTION = [
  "Identify the language of the patient question below (english, filipino, or taglish for mixed English-Filipino),",
  "then render the question in English for a keyword search of an English-only clinic knowledge base.",
  'Reply with only a JSON object of the form {"language":"...","english":"..."} (the language value in lowercase), with no prose and no code fences.',
  'Preserve every detail of the question in "english". If the question is already English, copy it unchanged.',
  "",
  "Patient question:",
].join("\n");

export function buildQueryAnalysisPrompt(query: string): string {
  return `${QUERY_ANALYSIS_INSTRUCTION}\n${query}`;
}

const LANGUAGES: readonly QueryLanguage[] = ["english", "filipino", "taglish"];

/**
 * Parse the analysis model's reply. A patient's question must never be lost to a
 * formatting hiccup: anything unusable falls back to the original query, so
 * retrieval still runs (on the patient's own words) instead of failing.
 */
export function parseQueryAnalysis(raw: string, originalQuery: string): QueryAnalysis {
  const fallback = { language: "unknown" as const, englishQuery: originalQuery.trim() };

  // The model may wrap the JSON in code fences or a sentence despite instructions.
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (!objectMatch) return fallback;

  try {
    const parsed = JSON.parse(objectMatch[0]) as { language?: unknown; english?: unknown };
    // Models capitalise ("Filipino", "Taglish") despite the instruction; a
    // case-sensitive check here would silently demote a correct detection to
    // "unknown" and drop the reply-language rule the fix exists for.
    const rawLanguage = typeof parsed.language === "string" ? parsed.language.trim().toLowerCase() : "";
    const language = LANGUAGES.includes(rawLanguage as QueryLanguage)
      ? (rawLanguage as QueryLanguage)
      : "unknown";
    const englishQuery = typeof parsed.english === "string" ? parsed.english.trim() : "";
    if (!englishQuery) return { language, englishQuery: fallback.englishQuery };
    return { language, englishQuery };
  } catch {
    return fallback;
  }
}

const LANGUAGE_RULES: Record<QueryLanguage, string> = {
  english: "Answer in English.",
  filipino: "Answer in Filipino.",
  taglish: "Answer in Taglish (mixed English and Filipino), matching how the patient mixes the two.",
  unknown: "Answer in the same language the patient writes in: English, Filipino, or Taglish.",
};

export function buildSystemPrompt(context: string, language: QueryLanguage): string {
  return `You are KlinikAid's 24/7 AI-driven clinic assistant.
Your goal is to answer clinic inquiries, guidelines, schedules, services, requirements, or diagnostic test preparations for patients and visitors of "Bloodcare Medical Laboratory".

You must base your answers ONLY on the provided Clinic Knowledge context. Do not make up information.
If the answer cannot be found in the context, politely state that you can only assist with clinic inquiries and refer them to contact the reception desk or clinical specialists. Do not diagnose conditions or give medical guidance.

${LANGUAGE_RULES[language]}

Clinic Knowledge context:
${context}`;
}
