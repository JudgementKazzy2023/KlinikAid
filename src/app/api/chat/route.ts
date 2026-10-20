import { createClient } from "@/lib/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-response";
import { validateChatMessages } from "@/lib/chat/validate-messages";
import { classifyRead } from "@/lib/read-outcome";
import {
  checkPrivacyConsent,
  PRIVACY_CONSENT_CHECK_FAILED_MESSAGE,
  PRIVACY_CONSENT_REQUIRED_MESSAGE,
} from "@/lib/auth/privacy-consent";
import {
  buildQueryAnalysisPrompt,
  buildSystemPrompt,
  parseQueryAnalysis,
  type QueryAnalysis,
} from "@/lib/chat/query-language";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

type EmbedContentFn = (req: {
  content: { role: string; parts: Array<{ text: string }> };
  outputDimensionality: number;
}) => Promise<{ embedding: { values: number[] } }>;

// Render the question in English for retrieval and detect the reply language
// (#73 item 9). The knowledge base is English-only, and embedding a Filipino
// question demotes the document that answers it below the match_count cutoff
// (the operating-hours doc ranks 3rd for the English wording, 10th for the
// Filipino one), which the model then answered with the out-of-scope decline.
// A failure here must not fail the chat: the original question is embedded
// instead and the reply language falls back to mirroring the patient.
async function analyseQuery(userQuery: string): Promise<QueryAnalysis> {
  try {
    const analysisModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await analysisModel.generateContent(buildQueryAnalysisPrompt(userQuery));
    return parseQueryAnalysis(result.response.text(), userQuery);
  } catch (err) {
    console.error("Query language analysis failed; retrieving with the original question:", err);
    return parseQueryAnalysis("", userQuery);
  }
}

interface MatchedDocument {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export async function POST(request: Request) {
  // 1. Session first (Standing Rule #1)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse("Unauthorized: Please sign in to chat.", 401);
  }

  // Consent gate (RA 10173): before the message reaches Gemini or chatbot_logs.
  const consent = await checkPrivacyConsent(supabase, user.id);
  if (consent.kind === "failed") {
    return errorResponse(PRIVACY_CONSENT_CHECK_FAILED_MESSAGE, 503, consent.error);
  }
  if (consent.kind === "not_accepted") {
    return errorResponse(PRIVACY_CONSENT_REQUIRED_MESSAGE, 403);
  }

  try {
    const body = await request.json();
    const { messages: rawMessages, sessionId } = (body ?? {}) as { messages?: unknown; sessionId?: string };

    // Bound what reaches the model: the input box caps length, a direct request does not.
    const checked = validateChatMessages(rawMessages);
    if (!checked.valid) {
      return errorResponse(checked.error);
    }
    const { messages, userQuery } = checked;
    const activeSessionId = sessionId || crypto.randomUUID();

    // 2. Enforce Rate Limit: Max 20 requests per hour keyed off authenticated user.id (prevents sessionId bypasses)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("chatbot_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneHourAgo);

    if (countError) {
      console.error("Failed to fetch message count for rate limiting:", countError);
    } else if (count !== null && count >= 20) {
      return errorResponse("Rate limit exceeded. You can only send up to 20 messages per hour.", 429);
    }

    // 3. English rendering for retrieval, language for the reply (#73 item 9)
    const analysis = await analyseQuery(userQuery);

    // 4. Generate query embedding via gemini-embedding-001 (768 dimensions)
    // The embedding is built from the English rendering, because the knowledge
    // base is English-only and a non-English embedding ranks the answering
    // document below the match_count cutoff. Everything the patient sees still
    // flows through their own words: history in their language, reply in it.
    // Note: text-embedding-004 is requested by spec, but returned 404 in this environment's Gemini API.
    // We use gemini-embedding-001 with outputDimensionality: 768 to achieve the correct 768-dim vector size.
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const embedResult = await (embeddingModel.embedContent as unknown as EmbedContentFn)({
      content: { role: "user", parts: [{ text: analysis.englishQuery }] },
      outputDimensionality: 768,
    });
    const queryEmbedding = embedResult.embedding?.values;

    if (!queryEmbedding) {
      return errorResponse("Failed to process query embeddings.");
    }

    // 5. Perform vector similarity search in public.rag_documents
    //
    // A failed search must not become an answer. The previous `|| []` made
    // "the vector index was unreachable" and "the knowledge base has nothing on
    // this" produce the same grounding string, and the model was then instructed
    // to answer *only* from it -- so a broken index returned a fluent, confident
    // 200 asserting the clinic has no information, indistinguishable from a
    // genuine gap in the documents. Absence of evidence and failure to look are
    // separated here, once, so no caller downstream has to.
    const search = classifyRead(
      await supabase.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_threshold: 0.6,
        // 8, not 5 (#73). The 0.6 threshold is not what drops the answering
        // document: measured against the live knowledge base, the operating-hours
        // doc lands at #6 with similarity 0.628 for the natural English rendering
        // "What time is the clinic open?" — above the threshold, outside a count
        // of 5 — and the model then declined with "not in my knowledge". The
        // English rendering lifts it to #3 for the literal question; the extra
        // count is headroom for phrasing variance in the rendering.
        match_count: 8,
      })
    );

    if (search.kind === "failed") {
      console.error("RAG match_documents RPC error:", search.error);
      // 503, not 200: the assistant genuinely could not answer, and a patient
      // told "we have no information" may act on that. The chat UI surfaces the
      // message, which points them at a human who can actually check.
      return errorResponse(
        "The clinic assistant is temporarily unavailable because its document search could not be reached. Please contact the reception desk.",
        503
      );
    }

    const matchedDocsList =
      search.kind === "ok" ? ((search.data ?? []) as unknown as MatchedDocument[]) : [];

    // 6. Construct RAG context
    const context = matchedDocsList.length > 0
      ? matchedDocsList.map((doc) => `Source: ${doc.title}\nContent: ${doc.content}`).join("\n\n")
      : "No relevant guidelines or clinic documents found.";

    // 7. Call Gemini 2.5 Flash with System Grounding, answered in the patient's language
    const systemPrompt = buildSystemPrompt(context, analysis.language);

    const chatModel = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    // Format history for Google Generative AI chat
    const rawHistory = messages.slice(0, -1).map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // Gemini requires history to start with a user turn.
    // The client initializes with a model greeting which must be stripped.
    const firstUserIndex = rawHistory.findIndex((m) => m.role === "user");
    const history = firstUserIndex >= 0 ? rawHistory.slice(firstUserIndex) : [];

    const chatSession = chatModel.startChat({ history });
    const chatResult = await chatSession.sendMessage(userQuery);
    const botResponse = chatResult.response.text();
    const tokensUsed = chatResult.response.usageMetadata?.totalTokenCount || 0;

    // 8. Log interaction in public.chatbot_logs (unchanged: the patient's own words, not the English rendering)
    // Note: Although guide mentions user_query, the active Supabase schema uses the user_message column.
    const { error: logError } = await supabase.from("chatbot_logs").insert({
      user_id: user.id,
      session_id: activeSessionId,
      user_message: userQuery,
      bot_response: botResponse,
      tokens_used: tokensUsed,
    });

    if (logError) {
      // The conversation is the audit record of what the assistant told a
      // patient. Swallowing this means a clinically-relevant exchange can vanish
      // from /admin/logs with nothing to indicate it happened. The answer to the
      // patient is still returned -- the log write failing does not make the
      // reply wrong -- but it is raised on the server so it is not silent.
      console.error("Failed to log chatbot interaction:", logError);
    }

    return successResponse({
      response: botResponse,
      tokensUsed,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    const message = err instanceof Error ? err.message : "Failed to process chat request.";
    return errorResponse(message, 500);
  }
}
