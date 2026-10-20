import { describe, expect, it } from "vitest";
import {
  buildRetrievalQueries,
  mergeMatchLists,
  MAX_RETRIEVAL_QUERIES,
  type RetrievalMatch,
} from "./retrieval";

function match(id: string, similarity: number, title = `doc-${id}`): RetrievalMatch {
  return { id, title, content: "content", metadata: null, similarity };
}

describe("buildRetrievalQueries", () => {
  const analysis = {
    englishQuery: "What time is the clinic open?",
    searchQueries: ["clinic opening hours", "lab operating hours"],
  };

  it("keeps the patient's words, the English rendering and the paraphrases, in order", () => {
    expect(buildRetrievalQueries("Anong oras bukas ang clinic?", analysis)).toEqual([
      "Anong oras bukas ang clinic?",
      "What time is the clinic open?",
      "clinic opening hours",
      "lab operating hours",
    ]);
  });

  it("deduplicates case-insensitively so the same phrasing is not embedded twice", () => {
    expect(
      buildRetrievalQueries("What time is the clinic open?", {
        englishQuery: "  what time is the clinic open? ",
        searchQueries: ["WHAT TIME IS THE CLINIC OPEN?", "opening hours"],
      })
    ).toEqual(["What time is the clinic open?", "opening hours"]);
  });

  it("trims variants and skips blanks", () => {
    expect(
      buildRetrievalQueries("  Anong oras?  ", { englishQuery: "   ", searchQueries: ["", "  hours "] })
    ).toEqual(["Anong oras?", "hours"]);
  });

  it("caps the number of embedded variants to bound cost", () => {
    const queries = buildRetrievalQueries("q", {
      englishQuery: "q2",
      searchQueries: ["q3", "q4", "q5", "q6"],
    });
    expect(queries).toHaveLength(MAX_RETRIEVAL_QUERIES);
  });

  it("never returns an empty list, even for an all-blank analysis", () => {
    expect(buildRetrievalQueries("Anong oras?", { englishQuery: " ", searchQueries: [] })).toEqual([
      "Anong oras?",
    ]);
  });

  it("degrades to the rendering alone when the analysis produced no paraphrases", () => {
    // The analysis call can fail; retrieval still runs on what it has.
    expect(buildRetrievalQueries("Anong oras?", { englishQuery: "What time?", searchQueries: [] })).toEqual([
      "Anong oras?",
      "What time?",
    ]);
  });
});

describe("mergeMatchLists", () => {
  it("unions lists and sorts by similarity descending", () => {
    const merged = mergeMatchLists(
      [
        [match("a", 0.7), match("b", 0.65)],
        [match("c", 0.9), match("a", 0.7)],
      ],
      8
    );
    expect(merged.map((doc) => [doc.id, doc.similarity])).toEqual([
      ["c", 0.9],
      ["a", 0.7],
      ["b", 0.65],
    ]);
  });

  it("keeps the best similarity when several queries return the same document", () => {
    const merged = mergeMatchLists([[match("a", 0.62)], [match("a", 0.81)], [match("a", 0.5)]], 8);
    expect(merged).toEqual([match("a", 0.81)]);
  });

  it("does not let one document repeated by every query fill the whole context", () => {
    const merged = mergeMatchLists(
      [
        [match("a", 0.9), match("b", 0.62)],
        [match("a", 0.9), match("c", 0.61)],
      ],
      2
    );
    expect(merged.map((doc) => doc.id)).toEqual(["a", "b"]);
  });

  it("cuts the union to topK", () => {
    const merged = mergeMatchLists([[match("a", 0.9), match("b", 0.8), match("c", 0.7)]], 2);
    expect(merged.map((doc) => doc.id)).toEqual(["a", "b"]);
  });

  it("tolerates empty and missing lists", () => {
    expect(mergeMatchLists([], 8)).toEqual([]);
    expect(mergeMatchLists([[], [match("a", 0.7)], []], 8)).toEqual([match("a", 0.7)]);
  });

  it("returns nothing rather than throwing when topK is zero", () => {
    expect(mergeMatchLists([[match("a", 0.9)]], 0)).toEqual([]);
  });
});
